/*
  Per-room state. Each room has two queues:

    queue1 — playable: every track here has a Sanity `audioUrl` ready to stream.
    queue2 — pending extraction: tracks whose audio isn't in Sanity yet. Each
             carries a `status` ("pending" | "processing" | "failed") for the UI.

  When a track in queue2 finishes extracting it's removed from queue2 and added
  to queue1 (see index.js, which listens for extraction "ready" events).
*/

const rooms = new Map();
let seq = 1;

export function nextId() {
  return seq++;
}

export function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      current: null, // { videoId, title, channel, thumbnail, audioUrl }
      isPlaying: false,
      position: 0, // seconds at lastUpdate
      lastUpdate: Date.now(),
      queue1: [],
      queue2: [],
      showRecommendations: false,
      users: new Map(), // socketId -> name
    });
  }
  return rooms.get(roomId);
}

export function peekRoom(roomId) {
  return rooms.get(roomId);
}

export function deleteRoom(roomId) {
  rooms.delete(roomId);
}

function livePosition(room) {
  if (!room.isPlaying) return room.position;
  return room.position + (Date.now() - room.lastUpdate) / 1000;
}

export function publicState(room) {
  return {
    current: room.current,
    isPlaying: room.isPlaying,
    position: livePosition(room),
    queue1: room.queue1,
    queue2: room.queue2,
    showRecommendations: room.showRecommendations,
    listeners: [...room.users.values()],
  };
}

// Add a ready-to-play track (must have audioUrl) to queue1. If nothing is
// playing, start it immediately.
export function addToQueue1(room, track) {
  const entry = {
    id: nextId(),
    videoId: track.videoId,
    title: track.title || "Unknown",
    channel: track.channel || "",
    thumbnail: track.thumbnail || "",
    duration: track.duration || "",
    audioUrl: track.audioUrl,
  };

  if (!room.current) {
    room.current = { ...entry };
    room.isPlaying = true;
    room.position = 0;
    room.lastUpdate = Date.now();
  } else {
    room.queue1.push(entry);
  }
  return entry;
}

// Add a placeholder to queue2 while its audio is extracted.
export function addToQueue2(room, track, status = "pending") {
  // Avoid duplicate placeholders for the same video.
  const existing = room.queue2.find((t) => t.videoId === track.videoId);
  if (existing) {
    existing.status = status;
    return existing;
  }
  const entry = {
    id: nextId(),
    videoId: track.videoId,
    title: track.title || "Unknown",
    channel: track.channel || "",
    thumbnail: track.thumbnail || "",
    duration: track.duration || "",
    status,
  };
  room.queue2.push(entry);
  return entry;
}

// Advance to the next queue1 track (or stop if empty).
export function advance(room) {
  if (room.queue1.length) {
    const next = room.queue1.shift();
    room.current = { ...next };
    room.isPlaying = true;
    room.position = 0;
  } else {
    room.current = null;
    room.isPlaying = false;
    room.position = 0;
  }
  room.lastUpdate = Date.now();
}
