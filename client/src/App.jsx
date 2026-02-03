import React, { useEffect, useMemo, useRef, useState } from "react";

const defaultWsUrl = import.meta.env.VITE_WS_URL || "ws://localhost:8080";

function formatTime(ts) {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function App() {
  const [wsUrl] = useState(defaultWsUrl);
  const [name, setName] = useState("Guest");
  const [message, setMessage] = useState("");
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("connecting");
  const wsRef = useRef(null);

  const canSend = status === "open" && message.trim().length > 0;

  const addEvent = (event) => {
    setEvents((prev) => [...prev, event].slice(-200));
  };

  const connect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setStatus("connecting");

    ws.addEventListener("open", () => {
      setStatus("open");
      ws.send(JSON.stringify({ type: "set-name", name }));
    });

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        addEvent(payload);
      } catch {
        addEvent({ type: "system", text: event.data, at: Date.now() });
      }
    });

    ws.addEventListener("close", () => {
      setStatus("closed");
      addEvent({ type: "system", text: "Disconnected.", at: Date.now() });
    });

    ws.addEventListener("error", () => {
      addEvent({ type: "system", text: "Connection error.", at: Date.now() });
    });
  };

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [wsUrl]);

  const handleSend = (event) => {
    event.preventDefault();
    if (!canSend) return;
    wsRef.current?.send(JSON.stringify({ type: "message", text: message }));
    setMessage("");
  };

  const handleNameChange = (event) => {
    const value = event.target.value;
    setName(value);
    if (status === "open") {
      wsRef.current?.send(JSON.stringify({ type: "set-name", name: value }));
    }
  };

  const statusLabel = useMemo(() => {
    if (status === "open") return "Online";
    if (status === "connecting") return "Connecting";
    return "Offline";
  }, [status]);

  return (
    <div className="app">
      <div className="chat">
        <header className="chat-header">
          <div>
            <h1>Chat</h1>
            <p className="meta">
              Connected to {wsUrl.replace(/^wss?:\/\//, "")}
            </p>
          </div>
          <div className={`status status-${status}`}>
            <span className="dot" />
            {statusLabel}
          </div>
        </header>

        <div className="messages">
          {events.length === 0 ? (
            <div className="empty">No messages yet.</div>
          ) : (
            events.map((event, index) => {
              if (event.type === "message") {
                return (
                  <div key={index} className="message">
                    <div className="meta">
                      <span className="name">{event.name}</span>
                      <span className="time">{formatTime(event.at)}</span>
                    </div>
                    <div className="body">{event.text}</div>
                  </div>
                );
              }

              if (event.type === "presence") {
                return (
                  <div key={index} className="system">
                    {event.name}{" "}
                    {event.action === "join"
                      ? "joined"
                      : event.action === "leave"
                        ? "left"
                        : "renamed"}
                    .
                  </div>
                );
              }

              return (
                <div key={index} className="system">
                  {event.text}
                </div>
              );
            })
          )}
        </div>

        <form className="composer" onSubmit={handleSend}>
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={
              status === "open" ? "Type a message..." : "Connecting..."
            }
            disabled={status !== "open"}
          />
          <button type="submit" disabled={!canSend}>
            Send
          </button>
        </form>

        <div className="footer">
          <label>
            <span>Your name</span>
            <input value={name} onChange={handleNameChange} maxLength={24} />
          </label>

          <button className="ghost" type="button" onClick={connect}>
            Reconnect
          </button>
        </div>
      </div>
    </div>
  );
}
