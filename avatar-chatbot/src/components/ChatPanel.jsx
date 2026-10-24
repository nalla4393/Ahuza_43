import { useEffect, useRef, useState } from "react";
import { listen, sttSupported } from "../lib/speech.js";

// Message list + text input + microphone button.
export default function ChatPanel({ messages, busy, onSend, muted, onToggleMute }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText("");
  };

  const mic = () => {
    if (listening) return;
    setListening(true);
    listen({ onResult: onSend, onEnd: () => setListening(false), onError: () => setListening(false) });
  };

  return (
    <div className="chat">
      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>{m.content}</div>
        ))}
        {busy && <div className="msg assistant">…</div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="inputbar">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" />
        {sttSupported && (
          <button type="button" onClick={mic} className={listening ? "active" : ""} title="Speak">🎤</button>
        )}
        <button type="button" onClick={onToggleMute} title="Toggle voice">{muted ? "🔇" : "🔊"}</button>
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
