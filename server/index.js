import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { Server } from "socket.io";

import { search, recommendations, searchEnabled } from "./youtube.js";
import { findSongByVideoId, sanityEnabled } from "./sanity.js";
import { enqueueExtraction, onExtraction, extract } from "./extractor.js";
import {
  getRoom,
  peekRoom,
  deleteRoom,
  publicState,
  addToQueue1,
  addToQueue2,
  advance,
} from "./rooms.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* --------------------------------- REST ---------------------------------- */

app.get("/api/config", (_req, res) => {
  res.json({ searchEnabled, sanityEnabled });
});

app.get("/api/search", async (req, res) => {
  if (!searchEnabled)
    return res.status(503).json({ error: "Search disabled — no YOUTUBE_API_KEY." });
  try {
    res.json({ items: await search(req.query.q) });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.get("/api/recommendations", async (req, res) => {
  if (!searchEnabled)
    return res.status(503).json({ error: "Recommendations disabled." });
  try {
    res.json({ items: await recommendations(req.query.videoId) });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// Debug / testing: get a streamable audio URL for a video over plain HTTP.
// Cache hit -> returns the Sanity URL instantly. Cache miss -> extracts now
// (blocks for a few seconds), caches it, then returns the URL.
// The real app does this via the Socket.IO "queueAdd" flow, not REST.
app.get("/api/audio/:videoId", async (req, res) => {
  const { videoId } = req.params;
  try {
    const existing = await findSongByVideoId(videoId);
    if (existing?.audioUrl)
      return res.json({ videoId, cached: true, audioUrl: existing.audioUrl });

    const song = await extract({
      videoId,
      title: req.query.title || "Unknown",
      channel: req.query.channel || "",
    });
    res.json({ videoId, cached: false, audioUrl: song.audioUrl });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Serve the built React client in production (client/dist).
const clientDist = path.join(__dirname, "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

/* ------------------------------- Socket.IO -------------------------------- */

function broadcastState(roomId) {
  const room = peekRoom(roomId);
  if (room) io.to(roomId).emit("state", publicState(room));
}

// Route extraction results back to the room that requested them.
onExtraction((event) => {
  const roomId = event.track?.roomId;
  if (!roomId) return;
  const room = peekRoom(roomId);
  if (!room) return;

  const item = room.queue2.find((t) => t.videoId === event.videoId);

  if (event.type === "pending" || event.type === "processing") {
    if (item) item.status = event.type;
    else addToQueue2(room, event.track, event.type);
  } else if (event.type === "failed") {
    if (item) item.status = "failed";
  } else if (event.type === "ready") {
    room.queue2 = room.queue2.filter((t) => t.videoId !== event.videoId);
    addToQueue1(room, {
      videoId: event.song.videoId,
      title: event.song.title,
      channel: event.song.channel,
      thumbnail: event.song.thumbnail,
      duration: event.song.duration,
      audioUrl: event.song.audioUrl,
    });
  }

  broadcastState(roomId);
});

io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("join", ({ roomId, name }) => {
    roomId = (roomId || "khushi").toString().trim().toLowerCase() || "khushi";
    name = (name || "Someone").toString().trim().slice(0, 24) || "Someone";
    currentRoom = roomId;
    socket.join(roomId);
    const room = getRoom(roomId);
    room.users.set(socket.id, name);
    socket.emit("state", publicState(room));
    io.to(roomId).emit("listeners", [...room.users.values()]);
    socket.to(roomId).emit("system", `${name} joined 💕`);
  });

  // Add a track. THE CORE ROUTING:
  //   in Sanity  -> queue1 (playable now)
  //   not yet    -> queue2 (extract, then it moves to queue1)
  socket.on("queueAdd", async (track) => {
    if (!currentRoom || !track?.videoId) return;
    const room = getRoom(currentRoom);
    try {
      const song = await findSongByVideoId(track.videoId);
      if (song?.audioUrl) {
        addToQueue1(room, { ...track, audioUrl: song.audioUrl });
      } else {
        addToQueue2(room, track, "pending");
        enqueueExtraction({ ...track, roomId: currentRoom });
      }
    } catch (err) {
      console.error("queueAdd failed:", err);
      socket.emit("system", "Couldn't add that song 😢");
    }
    broadcastState(currentRoom);
  });

  socket.on("queueRemove", ({ queue, id } = {}) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (queue === "queue2") room.queue2 = room.queue2.filter((t) => t.id !== id);
    else room.queue1 = room.queue1.filter((t) => t.id !== id);
    broadcastState(currentRoom);
  });

  socket.on("playback", ({ isPlaying, position } = {}) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.isPlaying = Boolean(isPlaying);
    if (typeof position === "number" && position >= 0) room.position = position;
    room.lastUpdate = Date.now();
    socket.to(currentRoom).emit("state", publicState(room));
  });

  socket.on("next", () => {
    if (!currentRoom) return;
    advance(getRoom(currentRoom));
    broadcastState(currentRoom);
  });

  socket.on("toggleRecommendations", (show) => {
    if (!currentRoom) return;
    getRoom(currentRoom).showRecommendations = Boolean(show);
    broadcastState(currentRoom);
  });

  socket.on("chat", (text) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    const name = room.users.get(socket.id) || "Someone";
    const msg = (text || "").toString().slice(0, 300).trim();
    if (msg)
      io.to(currentRoom).emit("chat", { name, text: msg, ts: Date.now() });
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
    const room = peekRoom(currentRoom);
    if (!room) return;
    const name = room.users.get(socket.id);
    room.users.delete(socket.id);
    io.to(currentRoom).emit("listeners", [...room.users.values()]);
    if (name) socket.to(currentRoom).emit("system", `${name} left 👋`);
    if (room.users.size === 0) {
      const id = currentRoom;
      setTimeout(() => {
        const r = peekRoom(id);
        if (r && r.users.size === 0) deleteRoom(id);
      }, 60_000);
    }
  });
});

server.listen(PORT, () => {
  console.log(`💕 musicforkhushi running on http://localhost:${PORT}`);
  if (!searchEnabled) console.log("⚠️  No YOUTUBE_API_KEY — search disabled.");
  if (!sanityEnabled) console.log("⚠️  No Sanity config — playback disabled.");
});
