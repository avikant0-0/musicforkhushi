/*
  YouTube Data API v3 — used only for *metadata*: search results and
  recommendations. The actual audio is extracted by server/extractor.js and
  served from Sanity. Keeping the API key on the server.
*/

const YT_BASE = "https://www.googleapis.com/youtube/v3";
const YT_KEY = process.env.YOUTUBE_API_KEY || "";

export const searchEnabled = Boolean(YT_KEY);

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

function decodeHtml(str = "") {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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

export async function search(q) {
  if (!YT_KEY) throw new Error("Search disabled — no YOUTUBE_API_KEY.");
  q = (q || "").toString().trim();
  if (!q) return [];
  const url = `${YT_BASE}/search?part=snippet&type=video&videoCategoryId=10&maxResults=20&q=${encodeURIComponent(
    q
  )}&key=${YT_KEY}`;
  const r = await fetch(url);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  return attachDurations(mapSearchItems(data));
}

// relatedToVideoId was removed by YouTube, so we approximate recommendations
// by searching for more music from the same channel + cleaned-up title.
export async function recommendations(videoId) {
  if (!YT_KEY) throw new Error("Recommendations disabled — no YOUTUBE_API_KEY.");
  videoId = (videoId || "").toString().trim();
  if (!videoId) return [];

  const metaUrl = `${YT_BASE}/videos?part=snippet&id=${videoId}&key=${YT_KEY}`;
  const meta = await (await fetch(metaUrl)).json();
  const snip = meta.items?.[0]?.snippet;

  let query = "music";
  if (snip) {
    const cleanTitle = snip.title
      .replace(/\(.*?\)|\[.*?\]/g, "")
      .replace(/official|video|audio|lyrics?|hd|4k/gi, "")
      .trim();
    query = `${snip.channelTitle} ${cleanTitle}`.slice(0, 100);
  }

  const url = `${YT_BASE}/search?part=snippet&type=video&videoCategoryId=10&maxResults=15&q=${encodeURIComponent(
    query
  )}&key=${YT_KEY}`;
  const data = await (await fetch(url)).json();
  if (data.error) throw new Error(data.error.message);
  const items = mapSearchItems(data).filter((i) => i.videoId !== videoId);
  return attachDurations(items);
}
