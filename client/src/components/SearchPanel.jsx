import { useState } from "react";
import { socket } from "../socket.js";

export default function SearchPanel() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function doSearch(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      if (data.error) setError(data.error);
      else setResults(data.items || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const add = (t) => socket.emit("queueAdd", t);

  return (
    <div className="panel search">
      <form onSubmit={doSearch} className="search-bar">
        <input
          placeholder="search a song…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit">{loading ? "…" : "search"}</button>
      </form>

      {error && <div className="error">{error}</div>}

      <ul className="track-list">
        {results.map((t) => (
          <li key={t.videoId} className="track">
            {t.thumbnail && <img src={t.thumbnail} alt="" />}
            <div className="track-meta">
              <div className="track-title">{t.title}</div>
              <div className="track-sub">
                {t.channel}
                {t.duration ? ` · ${t.duration}` : ""}
              </div>
            </div>
            <button className="add-btn" onClick={() => add(t)} title="add to queue">
              ＋
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
