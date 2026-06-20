/*
  Standalone demo: download a YouTube video's audio and STREAM it over HTTP.

  This is the bare mechanic behind the app (no Sanity, no queues) so you can see
  exactly how "download audio + stream it" works.

  Usage:
    node demo-audio.js <videoId-or-url>
    node demo-audio.js dQw4w9WgXcQ

  Then open the printed URL in a browser — it streams the audio, seekable.
  (Needs yt-dlp + ffmpeg on PATH — open a fresh terminal after installing them.)
*/
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import { statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node demo-audio.js <videoId-or-url>");
  process.exit(1);
}
// Accept a bare id or a full URL.
const videoId = arg.includes("http")
  ? new URL(arg).searchParams.get("v") || arg.split("/").pop()
  : arg;
const url = `https://www.youtube.com/watch?v=${videoId}`;

// ---- 1. DOWNLOAD: run yt-dlp to grab best audio as m4a -------------------
async function download() {
  const dir = await mkdtemp(path.join(tmpdir(), "demo-"));
  const out = path.join(dir, `${videoId}.m4a`);
  console.log(`↓ downloading audio for ${videoId} …`);

  await new Promise((resolve, reject) => {
    const ps = spawn("yt-dlp", [
      "-f", "bestaudio/best",
      "-x", "--audio-format", "m4a",
      "--no-playlist", "--no-progress",
      "-o", path.join(dir, "%(id)s.%(ext)s"),
      url,
    ], { stdio: ["ignore", "inherit", "inherit"] });
    ps.on("error", reject);
    ps.on("close", (c) => (c === 0 ? resolve() : reject(new Error("yt-dlp failed"))));
  });

  console.log(`✓ saved: ${out} (${(statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
  return out;
}

// ---- 2. STREAM: serve the file over HTTP with Range support --------------
function serve(file) {
  const server = http.createServer((req, res) => {
    if (req.url !== "/audio") {
      // a tiny page with an <audio> player
      res.setHeader("content-type", "text/html");
      return res.end(`<h2>${videoId}</h2><audio src="/audio" controls autoplay style="width:400px"></audio>`);
    }

    const size = statSync(file).size;
    const range = req.headers.range;

    if (range) {
      // Browser asks for a byte range (this is what enables streaming/seeking).
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : size - 1;
      res.writeHead(206, {
        "content-range": `bytes ${start}-${end}/${size}`,
        "accept-ranges": "bytes",
        "content-length": end - start + 1,
        "content-type": "audio/mp4",
      });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "content-length": size,
        "content-type": "audio/mp4",
        "accept-ranges": "bytes",
      });
      fs.createReadStream(file).pipe(res);
    }
  });

  server.listen(8080, () => {
    console.log("\n▶  open  http://localhost:8080  to stream it (Ctrl+C to stop)");
  });
}

download().then(serve).catch((e) => {
  console.error("✗", e.message || e);
  process.exit(1);
});
