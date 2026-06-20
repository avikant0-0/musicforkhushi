import { useEffect, useRef, useState } from "react";
import { socket } from "./socket.js";
import Join from "./components/Join.jsx";
import Player from "./components/Player.jsx";
import SearchPanel from "./components/SearchPanel.jsx";
import Queues from "./components/Queues.jsx";
import Recommendations from "./components/Recommendations.jsx";
import Chat from "./components/Chat.jsx";

export default function App() {
  const [joined, setJoined] = useState(false);
  const [identity, setIdentity] = useState({ name: "", roomId: "khushi" });
  const [state, setState] = useState(null);
  const [listeners, setListeners] = useState([]);
  const [messages, setMessages] = useState([]);
  const [config, setConfig] = useState({ searchEnabled: false, sanityEnabled: false });
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onState = (s) => {
      setState(s);
      if (s.listeners) setListeners(s.listeners);
    };
    const onListeners = setListeners;
    const onChat = (m) =>
      setMessages((prev) => [...prev.slice(-99), { ...m, kind: "chat" }]);
    const onSystem = (text) =>
      setMessages((prev) => [
        ...prev.slice(-99),
        { text, ts: Date.now(), kind: "system" },
      ]);
    // Re-join automatically after a reconnect.
    const onConnect = () => {
      if (identityRef.current.name) socket.emit("join", identityRef.current);
    };

    socket.on("state", onState);
    socket.on("listeners", onListeners);
    socket.on("chat", onChat);
    socket.on("system", onSystem);
    socket.on("connect", onConnect);
    return () => {
      socket.off("state", onState);
      socket.off("listeners", onListeners);
      socket.off("chat", onChat);
      socket.off("system", onSystem);
      socket.off("connect", onConnect);
    };
  }, []);

  function join(name, roomId) {
    const id = { name, roomId };
    setIdentity(id);
    socket.connect();
    socket.emit("join", id);
    setJoined(true);
  }

  if (!joined) return <Join onJoin={join} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">music for khushi 💕</div>
        <div className="room-info">
          <span className="room-chip">room: {identity.roomId}</span>
          <span className="listeners" title="who's here">
            🎧 {listeners.join(", ") || "just you"}
          </span>
        </div>
      </header>

      <main className="layout">
        <section className="main-col">
          <Player state={state} />
          <Queues state={state} />
        </section>

        <aside className="side-col">
          {config.searchEnabled ? (
            <SearchPanel />
          ) : (
            <div className="panel muted">
              Search disabled — no YouTube API key set.
            </div>
          )}
          <Recommendations state={state} enabled={config.searchEnabled} />
          <Chat messages={messages} name={identity.name} />
        </aside>
      </main>
    </div>
  );
}
