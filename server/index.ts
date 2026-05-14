import express from "express";
import http from "http";
import https from "https";
import fs from "fs";
import cors from "cors";
import os from "os";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import {
  listConversations,
  createConversation,
  updateConversationTitle,
  getMessages,
  createMessage,
  clearMessages,
  deleteConversation,
  deleteMessage,
  search,
  getHomeData,
} from "./db";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// TLS: if cert/key env vars are set, run HTTPS; otherwise plain HTTP
const TLS_CERT = process.env.TLS_CERT;
const TLS_KEY = process.env.TLS_KEY;

const server =
  TLS_CERT && TLS_KEY
    ? https.createServer(
        { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) },
        app
      )
    : http.createServer(app);

const isHttps = TLS_CERT && TLS_KEY;

const wss = new WebSocketServer({ server, path: "/ws" });

app.use(cors());
app.use(express.json());

// Track clients per conversation
const conversationClients = new Map<string, Set<WebSocket>>();
let totalConnected = 0;

function broadcastConnectedCount() {
  const msg = JSON.stringify({ type: "connected_count", count: totalConnected });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function broadcastToConversation(conversationId: string, data: unknown) {
  const clients = conversationClients.get(conversationId);
  if (!clients) return;
  const msg = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on("connection", (ws) => {
  totalConnected++;
  broadcastConnectedCount();

  let subscribedConversation: string | null = null;

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === "subscribe") {
        if (subscribedConversation) {
          conversationClients.get(subscribedConversation)?.delete(ws);
        }
        subscribedConversation = data.conversationId as string;
        if (!conversationClients.has(subscribedConversation)) {
          conversationClients.set(subscribedConversation, new Set());
        }
        conversationClients.get(subscribedConversation)!.add(ws);
      }

      if (data.type === "message" && subscribedConversation) {
        const { content, deviceName, clientId } = data;
        if (!content || !deviceName) return;
        const message = createMessage(subscribedConversation, content, deviceName);
        broadcastToConversation(subscribedConversation, {
          type: "message",
          payload: { ...message, clientId: clientId ?? null },
        });
        // Notify every connected client so all sidebars can reorder
        const touched = JSON.stringify({
          type: "conversation_touched",
          conversationId: subscribedConversation,
          updatedAt: message.created_at,
        });
        wss.clients.forEach((c) => {
          if (c.readyState === WebSocket.OPEN) c.send(touched);
        });
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    totalConnected--;
    if (subscribedConversation) {
      conversationClients.get(subscribedConversation)?.delete(ws);
    }
    broadcastConnectedCount();
  });
});

// REST endpoints
app.get("/api/device", (_req, res) => {
  res.json({ hostname: os.hostname() });
});

app.get("/api/home", (_req, res) => {
  const data = getHomeData();
  res.json({ ...data, connectedNodes: totalConnected });
});

app.get("/api/search", (req, res) => {
  const q = (req.query.q as string ?? "").trim();
  if (q.length < 1) return res.json({ conversations: [], messages: [] });
  res.json(search(q));
});

app.get("/api/conversations", (_req, res) => {
  res.json(listConversations());
});

app.post("/api/conversations", (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  const conversation = createConversation(title);
  const msg = JSON.stringify({ type: "conversation_created", payload: conversation });
  wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
  res.status(201).json(conversation);
});

app.patch("/api/conversations/:id", (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  updateConversationTitle(req.params.id, title);
  const msg = JSON.stringify({ type: "conversation_renamed", conversationId: req.params.id, title });
  wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
  res.json({ ok: true });
});

app.get("/api/conversations/:id/messages", (req, res) => {
  res.json(getMessages(req.params.id));
});

app.post("/api/conversations/:id/messages", (req, res) => {
  const { content, deviceName } = req.body;
  if (!content || !deviceName)
    return res.status(400).json({ error: "content and deviceName required" });
  const message = createMessage(req.params.id, content, deviceName);
  broadcastToConversation(req.params.id, { type: "message", payload: message });
  res.status(201).json(message);
});

app.delete("/api/messages/:id", (req, res) => {
  const conversationId = deleteMessage(req.params.id);
  if (!conversationId) return res.status(404).json({ error: "not found" });
  broadcastToConversation(conversationId, {
    type: "message_deleted",
    messageId: req.params.id,
    conversationId,
  });
  res.json({ ok: true });
});

app.delete("/api/conversations/:id/messages", (req, res) => {
  clearMessages(req.params.id);
  broadcastToConversation(req.params.id, { type: "messages_cleared", conversationId: req.params.id });
  res.json({ ok: true });
});

app.delete("/api/conversations/:id", (req, res) => {
  const { id } = req.params;
  broadcastToConversation(id, { type: "conversation_deleted", conversationId: id });
  deleteConversation(id);
  res.json({ ok: true });
});

// Serve built client
// __dirname is server/ in dev (tsx) and server/dist/ after tsc build
const serverRoot = path.basename(__dirname) === "dist" ? path.dirname(__dirname) : __dirname;
const clientDist = path.join(serverRoot, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const proto = isHttps ? "https" : "http";
const localIP = getLocalIP();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ClipSpace server running on ${proto}://0.0.0.0:${PORT}`);
  console.log(`Local network: ${proto}://${localIP}:${PORT}`);
  if (!isHttps) {
    console.log("TLS disabled — set TLS_CERT and TLS_KEY env vars to enable HTTPS");
  }
});

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface ?? []) {
      if (alias.family === "IPv4" && !alias.internal) return alias.address;
    }
  }
  return "localhost";
}
