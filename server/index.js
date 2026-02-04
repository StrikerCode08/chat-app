import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const clients = new Map();

const NAME_PREFIX = "Guest";
const NAME_SUFFIX_LENGTH = 4;
const NAME_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateGuestName() {
  let name = "";
  const used = new Set(Array.from(clients.values(), (client) => client.name));
  do {
    let suffix = "";
    for (let i = 0; i < NAME_SUFFIX_LENGTH; i += 1) {
      suffix += NAME_CHARSET[Math.floor(Math.random() * NAME_CHARSET.length)];
    }
    name = `${NAME_PREFIX}-${suffix}`;
  } while (used.has(name));
  return name;
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

wss.on("connection", (ws) => {
  const user = { id: randomUUID(), name: generateGuestName() };
  clients.set(ws, user);

  ws.send(
    JSON.stringify({
      type: "welcome",
      id: user.id,
      name: user.name,
      at: Date.now()
    })
  );

  ws.send(
    JSON.stringify({
      type: "system",
      text: "Connected to chat server.",
      at: Date.now()
    })
  );

  broadcast({
    type: "presence",
    action: "join",
    id: user.id,
    name: user.name,
    at: Date.now()
  });

  ws.on("message", (data) => {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", text: "Invalid JSON." }));
      return;
    }

    if (payload.type === "set-name") {
      const trimmed = String(payload.name || "").trim().slice(0, 24);
      const name = trimmed.length ? trimmed : "Guest";
      clients.get(ws).name = name;
      broadcast({
        type: "presence",
        action: "rename",
        id: clients.get(ws).id,
        name,
        at: Date.now()
      });
      return;
    }

    if (payload.type === "message") {
      const text = String(payload.text || "").trim();
      if (!text) return;
      const sender = clients.get(ws);
      broadcast({
        type: "message",
        id: sender.id,
        name: sender.name,
        text,
        at: Date.now()
      });
    }

    if (payload.type === "typing") {
      const sender = clients.get(ws);
      const isTyping = Boolean(payload.isTyping);
      const message = JSON.stringify({
        type: "typing",
        id: sender.id,
        name: sender.name,
        isTyping
      });
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === 1) {
          client.send(message);
        }
      }
    }

  });

  ws.on("close", () => {
    const left = clients.get(ws);
    clients.delete(ws);
    if (left) {
      broadcast({
        type: "presence",
        action: "leave",
        id: left.id,
        name: left.name,
        at: Date.now()
      });
    }
  });
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);
