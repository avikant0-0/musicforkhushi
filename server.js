import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const YT_KEY = process.env.YOUTUBE_API_KEY || "";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

/* ----------------------------- YouTube Data API ----------------------------- */

const YT_BASE = "https://www.googleapis.com/youtube/v3";

function isoDurationToSeconds(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return (+h || 0) * 3600 + (+min || 0) * 60 + (+s || 0);
}

function fmtDuration(seconds) {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Fetch durations for a batch of video ids and merge into results.
async function attachDurations(items) {
  const ids = items.map((i) => i.videoId).filter(Boolean);
  if (!ids.length) return items;
  try {
    const url = `${YT_BASE}/videos?part=contentDetails&id=${ids.join(
      ","
    )}&key=${YT_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    const map = {};
    (data.items || []).forEach((v) => {
      map[v.id] = isoDurationToSeconds(v.contentDetails?.duration);
    });
    return items.map((i) => ({
      ...i,
      durationSeconds: map[i.videoId] || 0,
      duration: fmtDuration(map[i.videoId] || 0),
    }));
  } catch {
    return items;
  }
}

function mapSearchItems(data) {
  return (data.items || [])
    .filter((it) => it.id && it.id.videoId)
    .map((it) => ({
      videoId: it.id.videoId,
      title: decodeHtml(it.snippet.title),
      channel: decodeHtml(it.snippet.channelTitle),
      thumbnail:
        it.snippet.thumbnails?.medium?.url ||
        it.snippet.thumbnails?.default?.url ||
        "",
    }));
}

function decodeHtml(str = "") {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Is search/recommendations available?
app.get("/api/config", (_req, res) => {
  res.json({ searchEnabled: Boolean(YT_KEY) });
});

app.get("/api/search", async (req, res) => {
  if (!YT_KEY) {
    return res
      .status(503)
      .json({ error: "Search disabled — no YOUTUBE_API_KEY configured." });
  }
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ items: [] });
  try {
    const url = `${YT_BASE}/search?part=snippet&type=video&videoCategoryId=10&maxResults=20&q=${encodeURIComponent(
      q
    )}&key=${YT_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) {
      return res.status(502).json({ error: data.error.message });
    }
    const items = await attachDurations(mapSearchItems(data));
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// "Recommendations" — relatedToVideoId is deprecated by YouTube, so we
// approximate by searching for more music from the same artist/channel
// plus the song's keywords.
app.get("/api/recommendations", async (req, res) => {
  if (!YT_KEY) {
    return res
      .status(503)
      .json({ error: "Recommendations disabled — no YOUTUBE_API_KEY." });
  }
  const videoId = (req.query.videoId || "").toString().trim();
  if (!videoId) return res.json({ items: [] });
  try {
    // Get the source video's channel + title to build a query.
    const metaUrl = `${YT_BASE}/videos?part=snippet&id=${videoId}&key=${YT_KEY}`;
    const metaRes = await fetch(metaUrl);
    const meta = await metaRes.json();
    const snip = meta.items?.[0]?.snippet;
    let query = "music";
    if (snip) {
      // Use the channel/artist name as the seed for similar tracks.
      const cleanTitle = snip.title
        .replace(/\(.*?\)|\[.*?\]/g, "")
        .replace(/official|video|audio|lyrics?|hd|4k/gi, "")
        .trim();
      query = `${snip.channelTitle} ${cleanTitle}`.slice(0, 100);
    }
    const url = `${YT_BASE}/search?part=snippet&type=video&videoCategoryId=10&maxResults=15&q=${encodeURIComponent(
      query
    )}&key=${YT_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    let items = mapSearchItems(data).filter((i) => i.videoId !== videoId);
    items = await attachDurations(items);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* ------------------------------- Room state -------------------------------- */
/*
  rooms: Map<roomId, {
    current: { videoId, title, channel, thumbnail } | null,
    isPlaying: bool,
    position: seconds (at lastUpdate),
    lastUpdate: ms epoch,
    queue: [{ id, videoId, title, channel, thumbnail, duration }],
    videoEnabled: bool,
    showRecommendations: bool,
    users: Map<socketId, name>,
  }>
*/
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      current: null,
      isPlaying: false,
      position: 0,
      lastUpdate: Date.now(),
      queue: [],
      videoEnabled: true,
      showRecommendations: false,
      users: new Map(),
    });
  }
  return rooms.get(roomId);
}

// Compute the room's live position (accounting for elapsed time while playing).
function livePosition(room) {
  if (!room.isPlaying) return room.position;
  return room.position + (Date.now() - room.lastUpdate) / 1000;
}

function publicState(room) {
  return {
    current: room.current,
    isPlaying: room.isPlaying,
    position: livePosition(room),
    queue: room.queue,
    videoEnabled: room.videoEnabled,
    showRecommendations: room.showRecommendations,
    listeners: [...room.users.values()],
  };
}

function broadcastState(roomId) {
  const room = rooms.get(roomId);
  if (room) io.to(roomId).emit("state", publicState(room));
}

function broadcastListeners(roomId) {
  const room = rooms.get(roomId);
  if (room) io.to(roomId).emit("listeners", [...room.users.values()]);
}

let queueSeq = 1;

io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("join", ({ roomId, name }) => {
    roomId = (roomId || "khushi").toString().trim().toLowerCase() || "khushi";
    name = (name || "Someone").toString().trim().slice(0, 24) || "Someone";
    currentRoom = roomId;
    socket.join(roomId);
    const room = getRoom(roomId);
    room.users.set(socket.id, name);
    // Send full state to the joining client.
    socket.emit("state", publicState(room));
    broadcastListeners(roomId);
    socket.to(roomId).emit("system", `${name} joined 💕`);
  });

  // Play / pause / seek. payload: { isPlaying, position }
  socket.on("playback", ({ isPlaying, position }) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.isPlaying = Boolean(isPlaying);
    if (typeof position === "number" && position >= 0) room.position = position;
    room.lastUpdate = Date.now();
    socket.to(currentRoom).emit("state", publicState(room));
  });

  // Change the currently playing track. payload: track object
  socket.on("playTrack", (track) => {
    if (!currentRoom || !track?.videoId) return;
    const room = getRoom(currentRoom);
    room.current = {
      videoId: track.videoId,
      title: track.title || "Unknown",
      channel: track.channel || "",
      thumbnail: track.thumbnail || "",
    };
    room.isPlaying = true;
    room.position = 0;
    room.lastUpdate = Date.now();
    broadcastState(currentRoom);
  });

  socket.on("queueAdd", (track) => {
    if (!currentRoom || !track?.videoId) return;
    const room = getRoom(currentRoom);
    room.queue.push({
      id: queueSeq++,
      videoId: track.videoId,
      title: track.title || "Unknown",
      channel: track.channel || "",
      thumbnail: track.thumbnail || "",
      duration: track.duration || "",
    });
    // If nothing is playing, start this immediately.
    if (!room.current) {
      const next = room.queue.shift();
      room.current = {
        videoId: next.videoId,
        title: next.title,
        channel: next.channel,
        thumbnail: next.thumbnail,
      };
      room.isPlaying = true;
      room.position = 0;
      room.lastUpdate = Date.now();
    }
    broadcastState(currentRoom);
  });

  socket.on("queueRemove", (id) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.queue = room.queue.filter((t) => t.id !== id);
    broadcastState(currentRoom);
  });

  socket.on("queueClear", () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.queue = [];
    broadcastState(currentRoom);
  });

  // Advance to next track in queue (also used on "ended").
  socket.on("next", () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (room.queue.length) {
      const next = room.queue.shift();
      room.current = {
        videoId: next.videoId,
        title: next.title,
        channel: next.channel,
        thumbnail: next.thumbnail,
      };
      room.isPlaying = true;
      room.position = 0;
    } else {
      room.isPlaying = false;
      room.position = 0;
    }
    room.lastUpdate = Date.now();
    broadcastState(currentRoom);
  });

  socket.on("toggleVideo", (enabled) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.videoEnabled = Boolean(enabled);
    broadcastState(currentRoom);
  });

  socket.on("toggleRecommendations", (show) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.showRecommendations = Boolean(show);
    broadcastState(currentRoom);
  });

  socket.on("chat", (text) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    const name = room.users.get(socket.id) || "Someone";
    const msg = (text || "").toString().slice(0, 300).trim();
    if (msg) io.to(currentRoom).emit("chat", { name, text: msg, ts: Date.now() });
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const name = room.users.get(socket.id);
    room.users.delete(socket.id);
    broadcastListeners(currentRoom);
    if (name) socket.to(currentRoom).emit("system", `${name} left 👋`);
    // Clean up empty rooms after a delay.
    if (room.users.size === 0) {
      setTimeout(() => {
        const r = rooms.get(currentRoom);
        if (r && r.users.size === 0) rooms.delete(currentRoom);
      }, 60_000);
    }
  });
});

server.listen(PORT, () => {
  console.log(`💕 musicforkhushi running on http://localhost:${PORT}`);
  if (!YT_KEY) {
    console.log(
      "⚠️  No YOUTUBE_API_KEY set — search & recommendations are disabled."
    );
  }
});
