import { useEffect, useState } from "react";
import { socket } from "../socket.js";

export default function Recommendations({ state, enabled }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const show = state?.showRecommendations;
  const videoId = state?.current?.videoId;

  useEffect(() => {
    if (!show || !videoId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/recommendations?videoId=${videoId}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setItems(d.items || []))
      .catch(() => !cancelled && setItems([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [show, videoId]);

  if (!enabled) return null;

  const add = (t) => socket.emit("queueAdd", t);
  const toggle = (e) => socket.emit("toggleRecommendations", e.target.checked);

  return (
    <div className="panel recs">
      <label className="rec-toggle">
        <input type="checkbox" checked={!!show} onChange={toggle} />
        recommendations
      </label>

      {show && (
        <>
          {loading && <div className="empty">finding similar songs…</div>}
          {!loading && !videoId && (
            <div className="empty">play something to get recs</div>
          )}
          <ul className="track-list">
            {items.map((t) => (
              <li key={t.videoId} className="track">
                {t.thumbnail && <img src={t.thumbnail} alt="" />}
                <div className="track-meta">
                  <div className="track-title">{t.title}</div>
                  <div className="track-sub">
                    {t.channel}
                    {t.duration ? ` · ${t.duration}` : ""}
                  </div>
                </div>
                <button className="add-btn" onClick={() => add(t)}>
                  ＋
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
