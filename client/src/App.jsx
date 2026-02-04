import React, { useEffect, useMemo, useRef, useState } from "react";

const defaultWsUrl = import.meta.env.VITE_WS_URL || "ws://localhost:8080";
function formatTime(ts) {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function App() {
  const [wsUrl] = useState(defaultWsUrl);
  const [name, setName] = useState("Guest");
  const [nameDraft, setNameDraft] = useState("Guest");
  const [message, setMessage] = useState("");
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("connecting");
  const [typingUsers, setTypingUsers] = useState({});
  const wsRef = useRef(null);
  const lastCommittedNameRef = useRef(name);
  const messagesRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const lastTypingSentRef = useRef(false);

  const canSend = status === "open" && message.trim().length > 0;

  const addEvent = (event) => {
    setEvents((prev) => [...prev, event].slice(-200));
  };

  const sendTyping = (isTyping) => {
    if (status !== "open") return;
    if (lastTypingSentRef.current === isTyping) return;
    lastTypingSentRef.current = isTyping;
    wsRef.current?.send(JSON.stringify({ type: "typing", isTyping }));
  };

  const scheduleTypingStop = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      sendTyping(false);
    }, 1200);
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
      lastTypingSentRef.current = false;
    });

    const handleIncoming = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "welcome") {
          const assignedName = String(payload.name || "").trim() || "Guest";
          setName(assignedName);
          setNameDraft(assignedName);
          lastCommittedNameRef.current = assignedName;
          return;
        }
        if (payload.type === "typing") {
          const { id, name: typingName, isTyping } = payload;
          if (!id) return;
          if (isTyping) {
            setTypingUsers((prev) => ({ ...prev, [id]: typingName }));
          } else {
            setTypingUsers((prev) => {
              if (!prev[id]) return prev;
              const next = { ...prev };
              delete next[id];
              return next;
            });
          }
          return;
        }
        addEvent(payload);
      } catch {
        addEvent({ type: "system", text: event.data, at: Date.now() });
      }
    };

    ws.addEventListener("message", handleIncoming);

    ws.addEventListener("close", () => {
      setStatus("closed");
      addEvent({ type: "system", text: "Disconnected.", at: Date.now() });
      setTypingUsers({});
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

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [events]);

  const handleSend = (event) => {
    event.preventDefault();
    if (!canSend) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    wsRef.current?.send(JSON.stringify({ type: "message", text: trimmed }));
    setMessage("");
    sendTyping(false);
  };

  const handleMessageChange = (event) => {
    const value = event.target.value;
    setMessage(value);
    if (value.trim().length === 0) {
      sendTyping(false);
      return;
    }
    sendTyping(true);
    scheduleTypingStop();
  };

  const handleNameChange = (event) => {
    const value = event.target.value;
    setNameDraft(value);
  };

  const commitName = () => {
    const trimmed = nameDraft.trim().slice(0, 24);
    const next = trimmed.length ? trimmed : "Guest";
    if (next === lastCommittedNameRef.current) {
      setNameDraft(next);
      return;
    }
    lastCommittedNameRef.current = next;
    setName(next);
    setNameDraft(next);
    if (status === "open") {
      wsRef.current?.send(JSON.stringify({ type: "set-name", name: next }));
    }
  };

  const handleNameKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitName();
      event.currentTarget.blur();
    }
  };

  const statusLabel = useMemo(() => {
    if (status === "open") return "Online";
    if (status === "connecting") return "Connecting";
    return "Offline";
  }, [status]);

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-3xl gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/10 dark:border-stone-800 dark:bg-stone-900">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3 dark:border-stone-800">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
              Chat
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-stone-400">
              Connected to {wsUrl.replace(/^wss?:\/\//, "")}
            </p>
          </div>
          <div
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
              status === "open"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                : status === "connecting"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
                  : "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                status === "open"
                  ? "bg-emerald-500"
                  : status === "connecting"
                    ? "bg-amber-500"
                    : "bg-rose-500"
              }`}
            />
            {statusLabel}
          </div>
        </header>

        <div
          className="grid max-h-[420px] gap-3 overflow-y-auto pr-1"
          ref={messagesRef}
        >
          {events.length === 0 ? (
            <div className="text-sm text-slate-400">No messages yet.</div>
          ) : (
            events.map((event, index) => {
              if (event.type === "message") {
                return (
                  <div
                    key={index}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-950"
                  >
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-stone-400">
                      <span className="font-semibold text-slate-900 dark:text-stone-100">
                        {event.name}
                      </span>
                      <span>{formatTime(event.at)}</span>
                    </div>
                    <div className="text-sm text-slate-900 dark:text-stone-100">
                      {event.text}
                    </div>
                  </div>
                );
              }

              if (event.type === "presence") {
                return (
                  <div
                    key={index}
                    className="text-xs text-slate-500 dark:text-stone-400"
                  >
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
                <div
                  key={index}
                  className="text-xs text-slate-500 dark:text-stone-400"
                >
                  {event.text}
                </div>
              );
            })
          )}
        </div>

        {Object.keys(typingUsers).length > 0 && (
          <div className="text-xs text-slate-500 dark:text-stone-400">
            {Object.values(typingUsers).join(", ")} typing…
          </div>
        )}

        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={handleSend}
        >
          <input
            value={message}
            onChange={handleMessageChange}
            onBlur={() => sendTyping(false)}
            placeholder={status === "open" ? "Type a message..." : "Connecting..."}
            disabled={status !== "open"}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Send
          </button>
        </form>

        <div className="grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-[1fr_auto] sm:items-end dark:border-stone-800">
          <label className="grid flex-1 gap-1 text-xs text-slate-500 dark:text-stone-400">
            <span>Your name</span>
            <input
              value={nameDraft}
              onChange={handleNameChange}
              onBlur={commitName}
              onKeyDown={handleNameKeyDown}
              maxLength={24}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
            />
          </label>

          <button
            className="rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
            type="button"
            onClick={connect}
          >
            Reconnect
          </button>
        </div>
      </div>
    </div>
  );
}
