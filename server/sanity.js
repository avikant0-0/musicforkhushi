import { createClient } from "@sanity/client";

/*
  Sanity is our permanent song library / cache.

  Each extracted song is one `song` document:
    {
      _type: "song",
      videoId, title, channel, thumbnail,
      duration, durationSeconds,
      audioFile: <file asset reference>,   // the actual audio bytes on Sanity's CDN
      audioUrl,                            // denormalized CDN url for fast reads
      createdAt
    }

  The dataset is schemaless from the server's point of view — we create/read
  documents directly. (You only need a Sanity Studio + schema if you want a UI
  to browse the library; see server/schema/song.js.)
*/

const projectId = process.env.SANITY_PROJECT_ID;
const dataset = process.env.SANITY_DATASET || "production";
const token = process.env.SANITY_TOKEN;

export const sanityEnabled = Boolean(projectId && token);

if (!sanityEnabled) {
  console.warn(
    "⚠️  Sanity not configured — set SANITY_PROJECT_ID and SANITY_TOKEN. " +
      "Songs can't be cached or streamed until you do."
  );
}

export const sanity = sanityEnabled
  ? createClient({
      projectId,
      dataset,
      apiVersion: process.env.SANITY_API_VERSION || "2024-01-01",
      token,
      // We need fresh reads (cache lookups) and writes, so don't use the CDN.
      useCdn: false,
    })
  : null;

// Look up an already-extracted song by its YouTube videoId.
// Returns the song (with a ready-to-stream `audioUrl`) or null.
export async function findSongByVideoId(videoId) {
  if (!sanity || !videoId) return null;
  return sanity.fetch(
    `*[_type == "song" && videoId == $videoId][0]{
      _id, videoId, title, channel, thumbnail, duration, durationSeconds,
      "audioUrl": coalesce(audioUrl, audioFile.asset->url)
    }`,
    { videoId }
  );
}

// Upload an audio buffer as a Sanity file asset and create the song document.
// Returns the created song with a streamable `audioUrl`.
export async function saveSong({
  videoId,
  title,
  channel,
  thumbnail,
  duration,
  durationSeconds,
  buffer,
  contentType = "audio/mp4",
  filename,
}) {
  if (!sanity) throw new Error("Sanity is not configured.");

  const asset = await sanity.assets.upload("file", buffer, {
    filename: filename || `${videoId}.m4a`,
    contentType,
  });

  const doc = await sanity.create({
    _type: "song",
    videoId,
    title: title || "Unknown",
    channel: channel || "",
    thumbnail: thumbnail || "",
    duration: duration || "",
    durationSeconds: durationSeconds || 0,
    audioFile: {
      _type: "file",
      asset: { _type: "reference", _ref: asset._id },
    },
    audioUrl: asset.url,
    createdAt: new Date().toISOString(),
  });

  return { ...doc, audioUrl: asset.url };
}
