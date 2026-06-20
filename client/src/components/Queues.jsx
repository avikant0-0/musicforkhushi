import { socket } from "../socket.js";

const statusLabel = {
  pending: "queued",
  processing: "extracting…",
  failed: "failed ✗",
};

export default function Queues({ state }) {
  const queue1 = state?.queue1 || [];
  const queue2 = state?.queue2 || [];

  const remove = (queue, id) => socket.emit("queueRemove", { queue, id });

  return (
    <div className="panel queues">
      <div className="queue-block">
        <h3>
          Up next <span className="count">{queue1.length}</span>
        </h3>
        {queue1.length === 0 && <div className="empty">nothing queued</div>}
        <ul className="track-list">
          {queue1.map((t) => (
            <li key={t.id} className="track">
              {t.thumbnail && <img src={t.thumbnail} alt="" />}
              <div className="track-meta">
                <div className="track-title">{t.title}</div>
                <div className="track-sub">{t.channel}</div>
              </div>
              <button
                className="rm-btn"
                onClick={() => remove("queue1", t.id)}
                title="remove"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>

      {queue2.length > 0 && (
        <div className="queue-block">
          <h3>
            Processing <span className="count">{queue2.length}</span>
          </h3>
          <ul className="track-list">
            {queue2.map((t) => (
              <li key={t.id} className={`track q2 ${t.status}`}>
                {t.thumbnail && <img src={t.thumbnail} alt="" />}
                <div className="track-meta">
                  <div className="track-title">{t.title}</div>
                  <div className="track-sub">
                    <span className={`badge ${t.status}`}>
                      {t.status === "processing" && <span className="spinner" />}
                      {statusLabel[t.status] || t.status}
                    </span>
                  </div>
                </div>
                {t.status === "failed" && (
                  <button
                    className="rm-btn"
                    onClick={() => remove("queue2", t.id)}
                    title="remove"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
