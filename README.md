# music for khushi 💕

A cozy little website where two people can listen to YouTube music **together, in perfect sync**. Press play on one device and it plays on the other — same song, same spot.

## Features

- 🎧 **Listen together** — real-time synced playback (play / pause / seek / skip propagate to everyone in the room).
- 🏠 **Private rooms** — share a room code so it's just the two of you. Default room is `khushi`.
- 📺 **Video toggle** — hide the video and switch to a pretty audio-only mode with a spinning record.
- 🔍 **Search** — find any song on YouTube and play it or add it to the queue.
- ➕ **Shared queue** — line up songs; both of you see the same up-next list.
- 💡 **Recommendations** — toggle on suggestions based on what's currently playing.
- 💬 **Chat** — say something cute while you listen.

## Setup

```bash
npm install
cp .env.example .env   # then edit .env
npm start
```

Open http://localhost:3000 in two browsers (or two devices) and join with the **same room code**.

### YouTube API key (for search & recommendations)

Search and recommendations use the YouTube Data API v3. Without a key you can still
paste YouTube links/IDs and listen together — only search/recs are disabled.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable **YouTube Data API v3**.
3. Create an **API key** under *Credentials*.
4. Put it in `.env` as `YOUTUBE_API_KEY=your_key_here`.

## How it works

- **Backend** (`server.js`): Express serves the static frontend and proxies YouTube
  search/recommendation requests (keeping your API key off the client). Socket.IO keeps a
  per-room state (current track, play/pause, position, queue, toggles) and broadcasts changes.
- **Frontend** (`public/`): The YouTube IFrame Player API handles playback. The client
  reconciles its player against the shared room state and emits local actions back to the room.

## Notes

- The "listen together" sync is best-effort: it keeps both players within ~2 seconds of each
  other and re-syncs on play/pause/seek/track changes.
- YouTube's `relatedToVideoId` API was removed, so recommendations are approximated by
  searching for more music from the current song's artist/keywords.
- Browsers may block autoplay with sound until you interact with the page — just hit play once.
