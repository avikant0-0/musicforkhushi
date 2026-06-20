# music for khushi 💕

Listen to YouTube music **together, in sync** — except the audio is extracted
once, cached in **Sanity**, and streamed from there. Search a song, and if it's
new it gets processed (audio extracted → stored in Sanity); if it's already in
Sanity it plays instantly. Either way, **audio always streams from Sanity**.

## How it works

```
search (YouTube Data API)  →  add a song
                                  │
                        is it already in Sanity?
                       ┌──────────┴───────────┐
                     yes                       no
                      │                         │
                   queue1                    queue2  (extraction)
              (playable, per-room)      yt-dlp → m4a → upload to Sanity
                      ▲                  create `song` doc, then ↓
                      └──── moves to queue1 when ready ──────────┘
                      │
                      ▼
        <audio src = Sanity CDN url>   ← always streams audio from Sanity
```

- **queue2** — the extraction pipeline (`server/extractor.js`). Videos whose
  audio isn't in Sanity yet. A background worker runs `yt-dlp`, uploads the
  audio to Sanity, creates a `song` document, then promotes it to queue1.
- **queue1** — the playable per-room "up next" (`server/rooms.js`). Every track
  has a ready-to-stream Sanity `audioUrl`.
- **Sanity** (`server/sanity.js`) is the permanent library / cache. The
  in-memory queues are just runtime.

## Project layout

```
server/         Node + Express + Socket.IO backend
  index.js        routes, sockets, queue routing
  sanity.js       Sanity client + cache lookup / save (Phase 1)
  extractor.js    yt-dlp extraction worker = queue2 (Phase 2)
  youtube.js      YouTube Data API (search / recommendations metadata)
  rooms.js        per-room state + queue1 / queue2
  schema/song.js  optional Sanity Studio schema (not required by the server)
client/         Vite + React frontend (Phase 4 — currently a smoke-test UI)
Dockerfile      Node + ffmpeg + yt-dlp, builds the client
```

## Setup

You need **Node 18+**, plus **yt-dlp** and **ffmpeg** if you want extraction to
run locally (the Docker image installs them for you).

```bash
# 1. backend deps
npm install

# 2. config
cp .env.example .env   # fill in YOUTUBE_API_KEY + Sanity values

# 3. client deps
npm --prefix client install
```

### Sanity (required for playback)

1. Create a free project at <https://www.sanity.io/>.
2. Note the **Project ID** and use dataset `production`.
3. Create a token with **write** access (Manage → API → Tokens, role *Editor*).
4. Put `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_TOKEN` in `.env`.

You don't need a Sanity Studio — the server writes documents/assets directly.
(If you want a UI to browse the library, spin up a Studio and use
`server/schema/song.js`.)

### Run (dev)

```bash
npm run dev        # backend on :3000  (auto-restarts)
npm run client     # Vite dev server on :5173 (proxies /api + sockets to :3000)
```

Open <http://localhost:5173>.

### Run (production / Docker)

```bash
docker build -t musicforkhushi .
docker run -p 3000:3000 --env-file .env musicforkhushi
```

The container builds the React client and the server serves `client/dist`.

## Deploy (Render)

`render.yaml` is a Docker blueprint. Create a Blueprint service from this repo
and set `YOUTUBE_API_KEY`, `SANITY_PROJECT_ID`, `SANITY_TOKEN` in the dashboard.

## Status

- ✅ **Phase 1** — Sanity client + cache lookup/save
- ✅ **Phase 2** — yt-dlp extraction worker (queue2) + two-queue routing
- ✅ **Phase 4** — full React UI (player, queues, search, recs, chat, sync)
- ⏳ Deploy to Render (configured, not yet pushed)

## Notes

- Extracting YouTube audio is against YouTube's Terms of Service — this is a
  small private project; use accordingly.
- Sanity free-tier storage/bandwidth is finite — fine for a personal library.
- First play of a *new* song waits for extraction; cached songs are instant.
