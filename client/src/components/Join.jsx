import { useState } from "react";

export default function Join({ onJoin }) {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("khushi");

  function submit(e) {
    e.preventDefault();
    onJoin(name.trim() || "Someone", roomId.trim().toLowerCase() || "khushi");
  }

  return (
    <div className="join-screen">
      <form className="join-card" onSubmit={submit}>
        <h1>music for khushi 💕</h1>
        <p className="sub">listen together, in sync</p>
        <label>
          your name
          <input
            autoFocus
            placeholder="khushi"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
          />
        </label>
        <label>
          room code
          <input
            placeholder="khushi"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            maxLength={32}
          />
        </label>
        <button type="submit">join the room →</button>
        <small>share the same room code to listen together</small>
      </form>
    </div>
  );
}
