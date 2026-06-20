import { useEffect, useRef, useState } from "react";
import { socket } from "../socket.js";

export default function Chat({ messages, name }) {
  const [text, setText] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    socket.emit("chat", t);
    setText("");
  }

  return (
    <div className="panel chat">
      <h3>chat</h3>
      <div className="chat-log">
        {messages.length === 0 && <div className="empty">say something cute 💬</div>}
        {messages.map((m, i) =>
          m.kind === "system" ? (
            <div key={i} className="chat-system">
              {m.text}
            </div>
          ) : (
            <div key={i} className={`chat-msg ${m.name === name ? "mine" : ""}`}>
              <span className="chat-name">{m.name}</span>
              <span className="chat-text">{m.text}</span>
            </div>
          )
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="chat-bar">
        <input
          placeholder="message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
        />
        <button type="submit">send</button>
      </form>
    </div>
  );
}
