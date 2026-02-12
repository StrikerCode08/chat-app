import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import cors from "cors";
import bcrypt from "bcryptjs";
import SQLiteStoreFactory from "connect-sqlite3";
import { WebSocketServer } from "ws";
import { PrismaClient } from "@prisma/client";

const PORT = process.env.PORT || 8080;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "dev-secret-change-me";
const DB_PATH =
  process.env.DB_PATH || path.join("data", "chat.db");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "data");

fs.mkdirSync(dataDir, { recursive: true });
process.env.DATABASE_URL =
  process.env.DATABASE_URL || `file:${path.resolve(__dirname, DB_PATH)}`;

const prisma = new PrismaClient();

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const sessionStore = new SQLiteStore({
  db: "sessions.db",
  dir: dataDir
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[http] ${req.method} ${req.url} ${res.statusCode} ${duration}ms`
    );
  });
  next();
});

const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = new Set(
  CLIENT_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.set("trust proxy", 1);

const sessionMiddleware = session({
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction
  }
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.size === 0) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);
app.use(express.json());
app.use(sessionMiddleware);

function sanitizeUsername(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
}

function validatePassword(password) {
  const trimmed = String(password || "").trim();
  return trimmed.length >= 6;
}

function ensureAuth(req, res, next) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.get("/api/me", (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.json({ user: null });
    return;
  }
  prisma.user
    .findUnique({ where: { id: userId }, select: { id: true, username: true } })
    .then((user) => res.json({ user: user || null }))
    .catch(() => res.status(500).json({ error: "Failed to load user." }));
});

app.post("/api/register", async (req, res) => {
  const username = sanitizeUsername(req.body?.username);
  const password = String(req.body?.password || "");

  if (username.length < 3) {
    res.status(400).json({ error: "Username must be at least 3 characters." });
    return;
  }
  if (!validatePassword(password)) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { username }
    });
    if (existing) {
      res.status(409).json({ error: "Username already taken." });
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: hash
      },
      select: { id: true, username: true }
    });
    req.session.userId = user.id;
    res.json({ user });
  } catch {
    res.status(500).json({ error: "Failed to create user." });
  }
});

app.post("/api/login", async (req, res) => {
  const username = sanitizeUsername(req.body?.username);
  const password = String(req.body?.password || "");

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }

    req.session.userId = user.id;
    res.json({ user: { id: user.id, username: user.username } });
  } catch {
    res.status(500).json({ error: "Failed to login." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session?.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/history", ensureAuth, async (req, res) => {
  try {
    const rows = await prisma.message.findMany({
      orderBy: { id: "desc" },
      take: 100
    });
    res.json({
      messages: rows
        .map((row) => ({
          type: "message",
          id: row.userId,
          name: row.username,
          text: row.text,
          at: row.createdAt.getTime()
        }))
        .reverse()
    });
  } catch {
    res.status(500).json({ error: "Failed to load history." });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const clients = new Map();

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

server.on("upgrade", (request, socket, head) => {
  sessionMiddleware(request, {}, () => {
    if (!request.session?.userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });
});

wss.on("connection", (ws, request) => {
  const connectAsync = async () => {
    const user = await prisma.user.findUnique({
      where: { id: request.session.userId },
      select: { id: true, username: true }
    });
    if (!user) {
      ws.close();
      return;
    }

    const clientUser = { id: user.id, name: user.username };
    clients.set(ws, clientUser);

    ws.send(
      JSON.stringify({
        type: "welcome",
        id: clientUser.id,
        name: clientUser.name,
        at: Date.now()
      })
    );

    const historyRows = await prisma.message.findMany({
      orderBy: { id: "desc" },
      take: 100
    });
    ws.send(
      JSON.stringify({
        type: "history",
        messages: historyRows
          .map((row) => ({
            type: "message",
            id: row.userId,
            name: row.username,
            text: row.text,
            at: row.createdAt.getTime()
          }))
          .reverse()
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
      id: clientUser.id,
      name: clientUser.name,
      at: Date.now()
    });
  };

  connectAsync().catch(() => {
    ws.close();
  });

  ws.on("message", (data) => {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", text: "Invalid JSON." }));
      return;
    }

    if (payload.type === "message") {
      const text = String(payload.text || "").trim();
      if (!text) return;
      const sender = clients.get(ws);
      const now = Date.now();
      prisma.message
        .create({
          data: {
            userId: sender.id,
            username: sender.name,
            text,
            createdAt: new Date(now)
          }
        })
        .then(() => {
          broadcast({
            type: "message",
            id: sender.id,
            name: sender.name,
            text,
            at: now
          });
        })
        .catch(() => {
          ws.send(
            JSON.stringify({
              type: "error",
              text: "Failed to save message."
            })
          );
        });
      return;
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

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

async function verifyDatabase() {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log("[db] Prisma connected.");
  } catch (error) {
    console.error("[db] Prisma connection failed.", error);
  }
}

verifyDatabase();

process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled rejection", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[process] Uncaught exception", error);
});
