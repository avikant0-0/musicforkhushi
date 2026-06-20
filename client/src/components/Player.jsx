import { useEffect, useRef } from "react";
import { socket } from "../socket.js";

/*
  Reconciles the local <audio> element against the shared room state.

  - When the server's state changes, we apply it to the audio element while
    `suppress` is on, so our own play/pause/seek handlers don't echo it back
    and cause a feedback loop.
  - User-initiated play/pause/seek emit "playback" so everyone else follows.
  - When a track ends, we ask the server to advance ("next").
*/
export default function Player({ state }) {
  const audioRef = useRef(null);
  const suppress = useRef(false);

  const current = state?.current;

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !state) return;

    suppress.current = true;

    if (current?.audioUrl && a.src !== current.audioUrl) {
      a.src = current.audioUrl;
    }
    if (!current?.audioUrl) {
      a.removeAttribute("src");
      a.load();
    }

    const pos = state.position || 0;
    if (current?.audioUrl && Math.abs(a.currentTime - pos) > 1.5) {
      a.currentTime = pos;
    }

    if (state.isPlaying && a.paused) a.play().catch(() => {});
    else if (!state.isPlaying && !a.paused) a.pause();

    const t = setTimeout(() => (suppress.current = false), 300);
    return () => clearTimeout(t);
  }, [state, current?.audioUrl]);

  const emitPlayback = (isPlaying) => {
    if (suppress.current) return;
    socket.emit("playback", {
      isPlaying,
      position: audioRef.current?.currentTime || 0,
    });
  };

  return (
    <div className="panel player">
      <div className={`disc ${state?.isPlaying ? "spinning" : ""}`}>
        {current?.thumbnail ? (
          <img src={current.thumbnail} alt="" />
        ) : (
          <div className="disc-empty">♪</div>
        )}
        <div className="disc-hole" />
      </div>

      <div className="now-playing">
        <div className="np-title">{current?.title || "nothing playing"}</div>
        <div className="np-channel">{current?.channel || "add a song to start →"}</div>

        <audio
          ref={audioRef}
          controls
          preload="auto"
          onPlay={() => emitPlayback(true)}
          onPause={() => emitPlayback(false)}
          onSeeked={() => emitPlayback(!audioRef.current.paused)}
          onEnded={() => socket.emit("next")}
        />

        <button
          className="skip-btn"
          onClick={() => socket.emit("next")}
          disabled={!current}
        >
          skip ⏭
        </button>
      </div>
    </div>
  );
}
