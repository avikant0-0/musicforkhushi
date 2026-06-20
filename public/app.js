/* =========================================================================
   music for khushi — client
   Handles: YouTube IFrame player, Socket.IO sync, search, queue,
   recommendations, chat, video toggle.
   ========================================================================= */

const socket = io();

let player = null;
let playerReady = false;
let pendingState = null; // state received before the player was ready

let me = { name: "", room: "" };
let searchEnabled = false;

// Local mirror of the room state.
let roomState = {
  current: null,
  isPlaying: false,
  position: 0,
  queue: [],
  videoEnabled: true,
  showRecommendations: false,
};

let isDraggingSeek = false;
// Ignore player onStateChange echoes for a short window after we apply a
// remote-driven change (prevents infinite sync loops).
let suppressEmitUntil = 0;
let lastRecsVideoId = null;

/* ----------------------------- DOM helpers ----------------------------- */
const $ = (id) => document.getElementById(id);
const el = {
  joinScreen: $("join-screen"),
  app: $("app"),
  nameInput: $("name-input"),
  roomInput: $("room-input"),
  joinBtn: $("join-btn"),
  roomName: $("room-name"),
  listenersText: $("listeners-text"),
  playerWrap: $("player-wrap"),
  audioOverlay: $("audio-overlay"),
  audioArt: $("audio-art"),
  npTitle: $("np-title"),
  npChannel: $("np-channel"),
  seek: $("seek"),
  curTime: $("cur-time"),
  durTime: $("dur-time"),
  playBtn: $("play-btn"),
  nextBtn: $("next-btn"),
  volume: $("volume"),
  videoToggle: $("video-toggle"),
  recToggle: $("rec-toggle"),
  searchForm: $("search-form"),
  searchInput: $("search-input"),
  searchResults: $("search-results"),
  searchNote: $("search-note"),
  queueList: $("queue-list"),
  queueCount: $("queue-count"),
  queueClear: $("queue-clear"),
  recsList: $("recs-list"),
  recsNote: $("recs-note"),
  chatLog: $("chat-log"),
  chatForm: $("chat-form"),
  chatInput: $("chat-input"),
  toast: $("toast"),
};

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 2600);
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Pull a video id out of a pasted YouTube URL (or return null).
function parseYouTubeId(input) {
  const s = input.trim();
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  if (/^[\w-]{11}$/.test(s)) return s;
  return null;
}

/* ----------------------------- YouTube player ----------------------------- */
// We don't show video, so stream the lowest quality (240p) to save bandwidth.
// 'small' = 240p in the YouTube IFrame API.
const LOW_QUALITY = "small";

// Ask the player to use the lowest quality. Note: modern YouTube treats this as
// a *suggestion* and may override it, but combined with the tiny player size it
// keeps bandwidth low.
function forceLowQuality() {
  try {
    if (player && player.setPlaybackQuality) {
      player.setPlaybackQuality(LOW_QUALITY);
    }
  } catch {}
}

// Global callback fired by the IFrame API script.
window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player("player", {
    height: "100%",
    width: "100%",
    playerVars: {
      autoplay: 0,
      controls: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      vq: LOW_QUALITY, // request 240p
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onPlaybackQualityChange: () => forceLowQuality(),
    },
  });
};

function onPlayerReady() {
  playerReady = true;
  player.setVolume(Number(el.volume.value));
  forceLowQuality();
  if (pendingState) {
    applyState(pendingState);
    pendingState = null;
  }
  startSeekLoop();
}

function onPlayerStateChange(e) {
  // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  const now = Date.now();
  if (e.data === YT.PlayerState.ENDED) {
    // Whoever's player ends asks the server to advance.
    socket.emit("next");
    return;
  }

  // Re-assert low quality whenever playback (re)starts or buffers.
  if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) {
    forceLowQuality();
  }

  if (now < suppressEmitUntil) return; // ignore echoes from remote-applied changes

  if (e.data === YT.PlayerState.PLAYING) {
    if (!roomState.isPlaying) {
      socket.emit("playback", { isPlaying: true, position: getCurrentTime() });
    }
    updatePlayBtn(true);
  } else if (e.data === YT.PlayerState.PAUSED) {
    if (roomState.isPlaying) {
      socket.emit("playback", { isPlaying: false, position: getCurrentTime() });
    }
    updatePlayBtn(false);
  }
}

function getCurrentTime() {
  try {
    return player && player.getCurrentTime ? player.getCurrentTime() : 0;
  } catch {
    return 0;
  }
}

function getDuration() {
  try {
    return player && player.getDuration ? player.getDuration() : 0;
  } catch {
    return 0;
  }
}

/* ----------------------------- Apply room state ----------------------------- */
function applyState(state) {
  roomState = { ...roomState, ...state };

  // ---- Now playing / player sync ----
  renderNowPlaying();
  syncPlayer(state);

  // ---- Queue ----
  renderQueue();

  // ---- Toggles ----
  el.videoToggle.checked = state.videoEnabled;
  el.recToggle.checked = state.showRecommendations;
  applyVideoVisibility(state.videoEnabled);
  applyRecommendationsVisibility(state.showRecommendations);

  // ---- Listeners ----
  if (state.listeners) renderListeners(state.listeners);

  updatePlayBtn(state.isPlaying);
}

function syncPlayer(state) {
  if (!playerReady) {
    pendingState = state;
    return;
  }
  if (!state.current) {
    // nothing playing
    try {
      player.stopVideo();
    } catch {}
    return;
  }

  const loadedId = currentlyLoadedId();
  suppressEmitUntil = Date.now() + 1000;

  if (loadedId !== state.current.videoId) {
    // Load new track at the shared position.
    if (state.isPlaying) {
      player.loadVideoById({
        videoId: state.current.videoId,
        startSeconds: state.position || 0,
        suggestedQuality: LOW_QUALITY,
      });
    } else {
      player.cueVideoById({
        videoId: state.current.videoId,
        startSeconds: state.position || 0,
        suggestedQuality: LOW_QUALITY,
      });
    }
    forceLowQuality();
    return;
  }

  // Same track loaded — reconcile position & play/pause.
  const drift = Math.abs(getCurrentTime() - (state.position || 0));
  if (drift > 1.8) {
    player.seekTo(state.position || 0, true);
  }
  const playerState = safePlayerState();
  if (state.isPlaying && playerState !== YT.PlayerState.PLAYING) {
    player.playVideo();
  } else if (!state.isPlaying && playerState === YT.PlayerState.PLAYING) {
    player.pauseVideo();
  }
}

function currentlyLoadedId() {
  try {
    const data = player.getVideoData ? player.getVideoData() : null;
    return data && data.video_id ? data.video_id : null;
  } catch {
    return null;
  }
}

function safePlayerState() {
  try {
    return player.getPlayerState ? player.getPlayerState() : -1;
  } catch {
    return -1;
  }
}

/* ----------------------------- Render helpers ----------------------------- */
function renderNowPlaying() {
  if (roomState.current) {
    el.npTitle.textContent = roomState.current.title;
    el.npChannel.textContent = roomState.current.channel || "";
    const art =
      roomState.current.thumbnail ||
      `https://i.ytimg.com/vi/${roomState.current.videoId}/hqdefault.jpg`;
    el.audioArt.src = art;
  } else {
    el.npTitle.textContent = "nothing playing yet";
    el.npChannel.textContent = "search for a song to get started 💫";
    el.audioArt.removeAttribute("src");
  }
}

function renderListeners(list) {
  const count = list.length;
  if (count <= 1) {
    el.listenersText.textContent = "just you";
  } else {
    el.listenersText.textContent = `${count} listening · ${list.join(", ")}`;
  }
}

function renderQueue() {
  const q = roomState.queue || [];
  el.queueCount.textContent = q.length;
  if (!q.length) {
    el.queueList.innerHTML = `<div class="empty">queue is empty 🌙<br/>add songs from search</div>`;
    return;
  }
  el.queueList.innerHTML = q
    .map(
      (t) => `
    <div class="track">
      <img class="track-thumb" src="${
        t.thumbnail || `https://i.ytimg.com/vi/${t.videoId}/default.jpg`
      }" alt="" />
      <div class="track-info">
        <div class="track-title">${escapeHtml(t.title)}</div>
        <div class="track-meta">${escapeHtml(t.channel || "")} ${
        t.duration ? "· " + t.duration : ""
      }</div>
      </div>
      <div class="track-actions">
        <button class="mini-btn play-now" data-action="play" data-id="${t.id}">play</button>
        <button class="mini-btn" data-action="remove" data-id="${t.id}">remove</button>
      </div>
    </div>`
    )
    .join("");
}

function trackCardHtml(t, context) {
  const thumb =
    t.thumbnail || `https://i.ytimg.com/vi/${t.videoId}/mqdefault.jpg`;
  return `
    <div class="track">
      <img class="track-thumb" src="${thumb}" alt="" />
      <div class="track-info">
        <div class="track-title">${escapeHtml(t.title)}</div>
        <div class="track-meta">${escapeHtml(t.channel || "")} ${
    t.duration ? "· " + t.duration : ""
  }</div>
      </div>
      <div class="track-actions">
        <button class="mini-btn play-now" data-ctx="${context}" data-action="playnow" data-vid="${
    t.videoId
  }">play</button>
        <button class="mini-btn" data-ctx="${context}" data-action="queue" data-vid="${
    t.videoId
  }">+ queue</button>
      </div>
    </div>`;
}

/* ----------------------------- Video / recs toggle ----------------------------- */
function applyVideoVisibility(enabled) {
  if (enabled) {
    el.audioOverlay.classList.add("hidden");
  } else {
    el.audioOverlay.classList.remove("hidden");
  }
}

function applyRecommendationsVisibility(show) {
  if (show) {
    el.recsNote.classList.add("hidden");
    maybeLoadRecommendations();
  } else {
    el.recsNote.classList.remove("hidden");
    el.recsNote.textContent =
      "turn on the “recommendations” toggle to see suggestions based on what’s playing.";
    el.recsList.innerHTML = "";
    lastRecsVideoId = null;
  }
}

async function maybeLoadRecommendations() {
  if (!roomState.showRecommendations) return;
  if (!searchEnabled) {
    el.recsNote.classList.remove("hidden");
    el.recsNote.textContent =
      "recommendations need a YOUTUBE_API_KEY on the server.";
    return;
  }
  if (!roomState.current) {
    el.recsNote.classList.remove("hidden");
    el.recsNote.textContent = "play a song first to see recommendations.";
    el.recsList.innerHTML = "";
    return;
  }
  if (roomState.current.videoId === lastRecsVideoId) return; // already loaded
  lastRecsVideoId = roomState.current.videoId;
  el.recsNote.classList.add("hidden");
  el.recsList.innerHTML = `<div class="loader">finding songs you'll love… 💫</div>`;
  try {
    const r = await fetch(
      `/api/recommendations?videoId=${encodeURIComponent(
        roomState.current.videoId
      )}`
    );
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "failed");
    if (!data.items || !data.items.length) {
      el.recsList.innerHTML = `<div class="empty">no recommendations found</div>`;
      return;
    }
    el.recsList.innerHTML = data.items
      .map((t) => trackCardHtml(t, "recs"))
      .join("");
  } catch (err) {
    el.recsList.innerHTML = `<div class="empty">couldn't load recommendations</div>`;
  }
}

/* ----------------------------- Search ----------------------------- */
async function doSearch(query) {
  // Direct link / id?
  const vid = parseYouTubeId(query);
  if (vid) {
    el.searchResults.innerHTML = `<div class="loader">loading that link…</div>`;
    // We don't have metadata for a raw id; play it directly with a fallback title.
    const track = {
      videoId: vid,
      title: query.includes("http") ? "Shared link" : vid,
      channel: "",
      thumbnail: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
    };
    el.searchResults.innerHTML = trackCardHtml(track, "search");
    return;
  }

  if (!searchEnabled) {
    el.searchNote.classList.remove("hidden");
    el.searchNote.textContent =
      "search needs a YOUTUBE_API_KEY on the server. you can still paste a YouTube link to play it.";
    return;
  }

  el.searchResults.innerHTML = `<div class="loader">searching… 🔍</div>`;
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "search failed");
    if (!data.items || !data.items.length) {
      el.searchResults.innerHTML = `<div class="empty">no results 😢</div>`;
      return;
    }
    el.searchResults.innerHTML = data.items
      .map((t) => trackCardHtml(t, "search"))
      .join("");
  } catch (err) {
    el.searchResults.innerHTML = `<div class="empty">${escapeHtml(
      String(err.message || err)
    )}</div>`;
  }
}

// Build a track object from a card's button by reading its sibling DOM.
function trackFromButton(btn) {
  const card = btn.closest(".track");
  const title = card.querySelector(".track-title").textContent.trim();
  const meta = card.querySelector(".track-meta").textContent.trim();
  const thumb = card.querySelector(".track-thumb").src;
  return {
    videoId: btn.dataset.vid,
    title,
    channel: meta.split("·")[0].trim(),
    thumbnail: thumb,
  };
}

/* ----------------------------- Seek loop ----------------------------- */
let seekLoop = null;
function startSeekLoop() {
  if (seekLoop) clearInterval(seekLoop);
  seekLoop = setInterval(() => {
    if (!playerReady || isDraggingSeek) return;
    const cur = getCurrentTime();
    const dur = getDuration();
    el.curTime.textContent = fmtTime(cur);
    el.durTime.textContent = fmtTime(dur);
    if (dur > 0) {
      el.seek.max = dur;
      el.seek.value = cur;
    }
  }, 500);
}

/* ----------------------------- Event wiring ----------------------------- */
function wireEvents() {
  // Join
  el.joinBtn.addEventListener("click", joinRoom);
  el.roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoom();
  });
  el.nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.roomInput.focus();
  });

  // Tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document
        .querySelectorAll(".tab-panel")
        .forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document
        .querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`)
        .classList.add("active");
    });
  });

  // Play / pause
  el.playBtn.addEventListener("click", () => {
    if (!roomState.current) return;
    const playing = safePlayerState() === YT.PlayerState.PLAYING;
    if (playing) {
      player.pauseVideo();
      socket.emit("playback", { isPlaying: false, position: getCurrentTime() });
    } else {
      player.playVideo();
      socket.emit("playback", { isPlaying: true, position: getCurrentTime() });
    }
  });

  // Next
  el.nextBtn.addEventListener("click", () => socket.emit("next"));

  // Seek
  el.seek.addEventListener("input", () => {
    isDraggingSeek = true;
    el.curTime.textContent = fmtTime(el.seek.value);
  });
  el.seek.addEventListener("change", () => {
    const pos = Number(el.seek.value);
    isDraggingSeek = false;
    if (!roomState.current) return;
    player.seekTo(pos, true);
    socket.emit("playback", {
      isPlaying: safePlayerState() === YT.PlayerState.PLAYING,
      position: pos,
    });
  });

  // Volume (local only)
  el.volume.addEventListener("input", () => {
    if (playerReady) player.setVolume(Number(el.volume.value));
  });

  // Toggles (synced)
  el.videoToggle.addEventListener("change", () => {
    socket.emit("toggleVideo", el.videoToggle.checked);
    applyVideoVisibility(el.videoToggle.checked);
  });
  el.recToggle.addEventListener("change", () => {
    socket.emit("toggleRecommendations", el.recToggle.checked);
    applyRecommendationsVisibility(el.recToggle.checked);
    if (el.recToggle.checked) {
      // jump to recs tab
      document.querySelector('.tab[data-tab="recs"]').click();
    }
  });

  // Search
  el.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = el.searchInput.value.trim();
    if (q) doSearch(q);
  });

  // Queue clear
  el.queueClear.addEventListener("click", () => socket.emit("queueClear"));

  // Delegated clicks on result/queue/rec lists
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "playnow") {
      socket.emit("playTrack", trackFromButton(btn));
      toast("now playing 🎶");
    } else if (action === "queue") {
      socket.emit("queueAdd", trackFromButton(btn));
      toast("added to queue ➕");
    } else if (action === "play") {
      // play a track that's already in the queue
      const id = Number(btn.dataset.id);
      const t = roomState.queue.find((x) => x.id === id);
      if (t) {
        socket.emit("playTrack", t);
        socket.emit("queueRemove", id);
      }
    } else if (action === "remove") {
      socket.emit("queueRemove", Number(btn.dataset.id));
    }
  });

  // Chat
  el.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.chatInput.value.trim();
    if (text) {
      socket.emit("chat", text);
      el.chatInput.value = "";
    }
  });
}

function joinRoom() {
  const name = el.nameInput.value.trim() || "Someone";
  const room = (el.roomInput.value.trim() || "khushi").toLowerCase();
  me = { name, room };
  socket.emit("join", { roomId: room, name });
  el.roomName.textContent = room;
  el.joinScreen.classList.add("hidden");
  el.app.classList.remove("hidden");
}

/* ----------------------------- Socket events ----------------------------- */
socket.on("state", (state) => {
  applyState(state);
  if (roomState.showRecommendations) maybeLoadRecommendations();
});

socket.on("listeners", (list) => renderListeners(list));

socket.on("system", (text) => addChat({ system: true, text }));

socket.on("chat", (msg) => addChat(msg));

function addChat(msg) {
  const div = document.createElement("div");
  if (msg.system) {
    div.className = "chat-msg system";
    div.textContent = msg.text;
  } else {
    div.className = "chat-msg" + (msg.name === me.name ? " mine" : "");
    div.innerHTML = `<span class="who">${escapeHtml(msg.name)}</span>${escapeHtml(
      msg.text
    )}`;
  }
  el.chatLog.appendChild(div);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
}

function updatePlayBtn(isPlaying) {
  el.playBtn.textContent = isPlaying ? "⏸" : "▶";
}

/* ----------------------------- Init ----------------------------- */
async function init() {
  wireEvents();
  try {
    const r = await fetch("/api/config");
    const cfg = await r.json();
    searchEnabled = cfg.searchEnabled;
    if (!searchEnabled) {
      el.searchNote.classList.remove("hidden");
      el.searchNote.textContent =
        "tip: search is off (no API key set). you can still paste any YouTube link to listen together.";
    }
  } catch {}
  // Prefill room from URL ?room=
  const params = new URLSearchParams(location.search);
  if (params.get("room")) el.roomInput.value = params.get("room");
}

init();
