import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const clients = new Map();

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

wss.on("connection", (ws) => {
  const user = { id: randomUUID(), name: "Guest" };
  clients.set(ws, user);

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
