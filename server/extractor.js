import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findSongByVideoId, saveSong } from "./sanity.js";

/*
  YouTube blocks anonymous requests from datacenter IPs ("Sign in to confirm
  you're not a bot"). To get around it in production we let yt-dlp use, in
  order of usefulness:
    - a cookies file (Netscape format). On Render, add it as a Secret File at
      /etc/secrets/cookies.txt, or point YTDLP_COOKIES at any path.
    - an outbound proxy (YTDLP_PROXY, e.g. a residential proxy URL).
    - an alternate player client (YTDLP_PLAYER_CLIENT, e.g. "android,web").
  All are optional; locally none are needed.
*/
const COOKIES_PATH =
  process.env.YTDLP_COOKIES ||
  (existsSync("/etc/secrets/cookies.txt") ? "/etc/secrets/cookies.txt" : "");
const PROXY = process.env.YTDLP_PROXY || "";
const PLAYER_CLIENT = process.env.YTDLP_PLAYER_CLIENT || "";

/*
  queue2 — the extraction pipeline.

  Videos whose audio isn't in Sanity yet get enqueued here. A single background
  worker pulls them one at a time, runs yt-dlp to grab the best audio as m4a
  (AAC — plays natively in every browser, including iOS/Safari), uploads it to
  Sanity, and creates the `song` document. Once ready, it's effectively in
  queue1 (playable) — callers learn that via the "ready" event.

  This queue lives in memory by design: the *permanent* library is Sanity, so a
  restart just means a pending job is re-requested next time someone adds it.
*/

const pending = []; // videoIds waiting to be processed
const inFlight = new Set(); // videoIds currently queued or processing
const waiters = new Map(); // videoId -> [track, ...] (who asked, e.g. which room)
const listeners = new Set(); // (event) => void
let running = false;

// Subscribe to extraction lifecycle events.
// Events: { type: "pending"|"processing"|"ready"|"failed", videoId, track, song?, error? }
export function onExtraction(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(event) {
  for (const cb of listeners) {
    try {
      cb(event);
    } catch (err) {
      console.error("extraction listener error:", err);
    }
  }
}

// Request extraction for a track. `track` should carry enough context to route
// the result back (e.g. a roomId). Safe to call repeatedly / from many rooms —
// extraction is de-duplicated per videoId, but every caller gets its own events.
export function enqueueExtraction(track) {
  const { videoId } = track || {};
  if (!videoId) return;

  const list = waiters.get(videoId) || [];
  list.push(track);
  waiters.set(videoId, list);

  emit({ type: "pending", videoId, track });

  if (!inFlight.has(videoId)) {
    inFlight.add(videoId);
    pending.push(videoId);
    pump();
  }
}

// Promise-based convenience: extract a track and resolve with the saved song
// (or reject on failure). Wraps the event-based queue for one-shot callers
// like the REST debug endpoint.
export function extract(track) {
  return new Promise((resolve, reject) => {
    const off = onExtraction((e) => {
      if (e.videoId !== track.videoId) return;
      if (e.type === "ready") {
        off();
        resolve(e.song);
      } else if (e.type === "failed") {
        off();
        reject(new Error(e.error));
      }
    });
    enqueueExtraction(track);
  });
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const videoId = pending.shift();
      const tracks = waiters.get(videoId) || [];
      const primary = tracks[0] || { videoId };

      for (const track of tracks) emit({ type: "processing", videoId, track });

      try {
        // Re-check the cache: someone may have extracted this meanwhile.
        let song = await findSongByVideoId(videoId);
        if (!song) song = await extractAndStore(primary);
        for (const track of tracks)
          emit({ type: "ready", videoId, track, song });
      } catch (err) {
        const error = String(err?.message || err);
        console.error(`extraction failed for ${videoId}:`, error);
        for (const track of tracks)
          emit({ type: "failed", videoId, track, error });
      } finally {
        waiters.delete(videoId);
        inFlight.delete(videoId);
      }
    }
  } finally {
    running = false;
  }
}

async function extractAndStore(track) {
  const dir = await mkdtemp(path.join(tmpdir(), "m4h-"));
  const outTemplate = path.join(dir, "%(id)s.%(ext)s");
  const url = `https://www.youtube.com/watch?v=${track.videoId}`;
  try {
    const args = [
      "-f",
      "bestaudio/best",
      "-x",
      "--audio-format",
      "m4a",
      "--no-playlist",
      "--no-progress",
    ];
    // Let yt-dlp find ffmpeg even when it isn't on PATH.
    if (process.env.FFMPEG_LOCATION)
      args.push("--ffmpeg-location", process.env.FFMPEG_LOCATION);
    // Bypass datacenter-IP bot detection where configured (see top of file).
    if (COOKIES_PATH) args.push("--cookies", COOKIES_PATH);
    if (PROXY) args.push("--proxy", PROXY);
    if (PLAYER_CLIENT)
      args.push("--extractor-args", `youtube:player_client=${PLAYER_CLIENT}`);
    args.push("-o", outTemplate, url);

    await runYtDlp(args);

    const file = path.join(dir, `${track.videoId}.m4a`);
    const buffer = await readFile(file);

    return await saveSong({
      videoId: track.videoId,
      title: track.title,
      channel: track.channel,
      thumbnail: track.thumbnail,
      duration: track.duration,
      durationSeconds: track.durationSeconds,
      buffer,
      contentType: "audio/mp4",
      filename: `${track.videoId}.m4a`,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const bin = process.env.YTDLP_PATH || "yt-dlp";
    const ps = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    ps.stderr.on("data", (d) => (stderr += d.toString()));
    ps.on("error", (err) =>
      reject(
        new Error(
          `Could not run yt-dlp ("${bin}"). Is it installed? ${err.message}`
        )
      )
    );
    ps.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-500)}`))
    );
  });
}
