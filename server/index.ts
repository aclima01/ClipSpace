import express from "express";
import http from "http";
import https from "https";
import fs from "fs";
import cors from "cors";
import os from "os";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import {
  getBriefingData,
  listNotebooks,
  createNotebook,
  updateNotebookTitle,
  deleteNotebook,
  getPage,
  createPage,
  updatePageTitle,
  deletePage,
  getMessages,
  createMessage,
  updateMessage,
  pinMessage,
  deleteMessage,
  clearMessages,
  search,
  getHomeData,
  getNotebookAiInstructions,
  updateNotebookAiInstructions,
  findTaskMessage,
  saveBriefing,
  loadBriefing,
  getMessage,
} from "./db";
import db from "./db";
import { chatWithAI, clearAISession, streamBriefing, improveMessage, buildImproveContext } from "./ai";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

const TLS_CERT = process.env.TLS_CERT;
const TLS_KEY = process.env.TLS_KEY;

const server =
  TLS_CERT && TLS_KEY
    ? https.createServer(
        { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) },
        app
      )
    : http.createServer(app);

const isHttps = !!(TLS_CERT && TLS_KEY);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(cors());
app.use(express.json());

// ── WebSocket ──────────────────────────────────────────────────────────────────

const pageClients = new Map<string, Set<WebSocket>>();
let totalConnected = 0;

function broadcastAll(data: unknown) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function broadcastToPage(pageId: string, data: unknown) {
  const clients = pageClients.get(pageId);
  if (!clients) return;
  const msg = JSON.stringify(data);
  clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

wss.on("connection", (ws) => {
  totalConnected++;
  broadcastAll({ type: "connected_count", count: totalConnected });

  let subscribedPage: string | null = null;

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === "subscribe") {
        if (subscribedPage) pageClients.get(subscribedPage)?.delete(ws);
        subscribedPage = data.pageId as string;
        if (!pageClients.has(subscribedPage)) {
          pageClients.set(subscribedPage, new Set());
        }
        pageClients.get(subscribedPage)!.add(ws);
      }

      if (data.type === "message" && subscribedPage) {
        const { content, deviceName, clientId } = data;
        if (!content || !deviceName) return;
        const message = createMessage(subscribedPage, content, deviceName);
        broadcastToPage(subscribedPage, {
          type: "message",
          payload: { ...message, clientId: clientId ?? null },
        });
        // Notify all clients so sidebars can reorder
        const page = getPage(subscribedPage);
        broadcastAll({
          type: "page_touched",
          pageId: subscribedPage,
          notebookId: page?.notebook_id ?? "",
          updatedAt: message.created_at,
        });
      }
    } catch { /* ignore malformed */ }
  });

  ws.on("close", () => {
    totalConnected--;
    if (subscribedPage) pageClients.get(subscribedPage)?.delete(ws);
    broadcastAll({ type: "connected_count", count: totalConnected });
  });
});

// ── Task lookup ────────────────────────────────────────────────────────────────

app.get("/api/tasks/:taskId", (req, res) => {
  const result = findTaskMessage(`#${req.params.taskId}`);
  if (!result) return res.status(404).json({ error: "not found" });
  res.json(result);
});

// ── REST: misc ─────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/device", (_req, res) => {
  res.json({ hostname: os.hostname() });
});

app.get("/api/home", (_req, res) => {
  res.json({ ...getHomeData(), connectedNodes: totalConnected });
});

app.get("/api/search", (req, res) => {
  const q = ((req.query.q as string) ?? "").trim();
  if (q.length < 1) return res.json({ notebooks: [], pages: [], messages: [] });
  res.json(search(q));
});

// ── REST: notebooks ────────────────────────────────────────────────────────────

app.get("/api/notebooks", (_req, res) => {
  res.json(listNotebooks());
});

app.post("/api/notebooks", (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  const notebook = createNotebook(title);
  broadcastAll({ type: "notebook_created", payload: notebook });
  res.status(201).json(notebook);
});

app.patch("/api/notebooks/:id", (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  updateNotebookTitle(req.params.id, title);
  broadcastAll({ type: "notebook_renamed", notebookId: req.params.id, title });
  res.json({ ok: true });
});

app.delete("/api/notebooks/:id", (req, res) => {
  const { id } = req.params;
  broadcastAll({ type: "notebook_deleted", notebookId: id });
  deleteNotebook(id);
  res.json({ ok: true });
});

// ── REST: pages ────────────────────────────────────────────────────────────────

app.post("/api/notebooks/:id/pages", (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  const page = createPage(req.params.id, title);
  broadcastAll({ type: "page_created", payload: page });
  res.status(201).json(page);
});

app.patch("/api/pages/:id", (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  const page = getPage(req.params.id);
  if (!page) return res.status(404).json({ error: "not found" });
  updatePageTitle(req.params.id, title);
  broadcastAll({
    type: "page_renamed",
    pageId: req.params.id,
    notebookId: page.notebook_id,
    title,
  });
  res.json({ ok: true });
});

app.delete("/api/pages/:id", (req, res) => {
  const { id } = req.params;
  const page = getPage(id);
  if (!page) return res.status(404).json({ error: "not found" });
  broadcastAll({
    type: "page_deleted",
    pageId: id,
    notebookId: page.notebook_id,
  });
  deletePage(id);
  res.json({ ok: true });
});

// ── REST: messages ─────────────────────────────────────────────────────────────

app.get("/api/pages/:id/messages", (req, res) => {
  res.json(getMessages(req.params.id));
});

app.post("/api/pages/:id/messages", (req, res) => {
  const { content, deviceName } = req.body;
  if (!content || !deviceName)
    return res.status(400).json({ error: "content and deviceName required" });
  const message = createMessage(req.params.id, content, deviceName);
  broadcastToPage(req.params.id, { type: "message", payload: message });
  res.status(201).json(message);
});

app.delete("/api/pages/:id/messages", (req, res) => {
  clearMessages(req.params.id);
  broadcastToPage(req.params.id, { type: "messages_cleared", pageId: req.params.id });
  res.json({ ok: true });
});

app.patch("/api/messages/:id/pin", (req, res) => {
  const { pinned } = req.body as { pinned: boolean };
  const pageId = pinMessage(req.params.id, pinned);
  if (!pageId) return res.status(404).json({ error: "not found" });
  broadcastToPage(pageId, { type: "message_pinned", messageId: req.params.id, pageId, pinned });
  res.json({ ok: true });
});

app.patch("/api/messages/:id", (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: "content required" });
  const pageId = updateMessage(req.params.id, content);
  if (!pageId) return res.status(404).json({ error: "not found" });
  // Read back the stored content (may have had task IDs injected)
  const stored = (db.prepare("SELECT content FROM messages WHERE id = ?").get(req.params.id) as { content: string } | undefined)?.content ?? content;
  broadcastToPage(pageId, { type: "message_edited", messageId: req.params.id, pageId, content: stored });
  res.json({ ok: true });
});

app.delete("/api/messages/:id", (req, res) => {
  const pageId = deleteMessage(req.params.id);
  if (!pageId) return res.status(404).json({ error: "not found" });
  broadcastToPage(pageId, { type: "message_deleted", messageId: req.params.id, pageId });
  res.json({ ok: true });
});

app.post("/api/messages/:id/improve", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" });

  const message = getMessage(req.params.id);
  if (!message) return res.status(404).json({ error: "not found" });

  const { pageId } = req.body as { pageId?: string };
  if (!pageId) return res.status(400).json({ error: "pageId required" });

  const page = getPage(pageId);
  const context = buildImproveContext(pageId, req.params.id);
  const instructions = page ? getNotebookAiInstructions(page.notebook_id) : "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    await improveMessage(message.content, context, instructions, (t) => send({ type: "token", content: t }));
    send({ type: "done" });
  } catch (e) {
    send({ type: "error", message: String(e) });
  }

  res.end();
});

// ── Briefing ───────────────────────────────────────────────────────────────────

app.get("/api/briefing", (req, res) => {
  const since = (req.query.since as string) || new Date(0).toISOString();
  res.json(getBriefingData(since));
});

app.get("/api/briefing/ai", (_req, res) => {
  res.json(loadBriefing() ?? null);
});

app.post("/api/ai/briefing", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" });

  const { since } = req.body as { since?: string };
  const data = getBriefingData(since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const nowMs = Date.now();
  function staleDays(iso: string) {
    return Math.floor((nowMs - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  }

  const lines: string[] = [];
  if (data.openTodos.length > 0) {
    lines.push("## To-dos abertos\n");
    for (const g of data.openTodos) {
      const days = staleDays(g.pageUpdatedAt);
      const staleTag = days >= 7 ? ` ⚠ parado há ${days} dias` : days >= 2 ? ` (${days}d sem atualização)` : "";
      lines.push(`**${g.notebookTitle} / ${g.pageTitle}**${staleTag}`);
      g.items.forEach((i) => lines.push(`- [ ] ${i}`));
      lines.push("");
    }
  } else {
    lines.push("Nenhum to-do aberto.\n");
  }
  if (data.recentPages.length > 0) {
    lines.push("## Atividade recente\n");
    data.recentPages.forEach((p) =>
      lines.push(`- **${p.notebookTitle} / ${p.pageTitle}** — ${p.newMessages} nota(s) nova(s)`)
    );
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (d: unknown) => res.write(`data: ${JSON.stringify(d)}\n\n`);
  let accumulated = "";
  try {
    await streamBriefing(lines.join("\n"), (t) => {
      accumulated += t;
      send({ type: "token", content: t });
    });
    const generatedAt = new Date().toISOString();
    saveBriefing(accumulated, generatedAt);
    broadcastAll({ type: "briefing_updated", generatedAt });
    send({ type: "done", generatedAt });
  } catch (e) {
    send({ type: "error", message: String(e) });
  }
  res.end();
});

// ── Notebook AI config ─────────────────────────────────────────────────────────

app.get("/api/notebooks/:id/ai-config", (req, res) => {
  res.json({ instructions: getNotebookAiInstructions(req.params.id) });
});

app.patch("/api/notebooks/:id/ai-config", (req, res) => {
  const { instructions } = req.body as { instructions?: string };
  updateNotebookAiInstructions(req.params.id, instructions ?? "");
  res.json({ ok: true });
});

// ── AI ─────────────────────────────────────────────────────────────────────────

app.post("/api/ai/chat", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" });

  const { pageId, message, deviceName } = req.body as {
    pageId: string;
    message: string;
    deviceName: string;
  };
  if (!pageId || !message)
    return res.status(400).json({ error: "pageId and message required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    await chatWithAI(pageId, message, deviceName, {
      onToken: (token) => send({ type: "token", content: token }),
      onAction: (action) => send({ type: "action", action }),
      broadcast: (pid, data) => broadcastToPage(pid, data),
    });
    send({ type: "done" });
  } catch (e) {
    send({ type: "error", message: String(e) });
  }

  res.end();
});

app.delete("/api/ai/session/:id", (req, res) => {
  clearAISession(req.params.id);
  res.json({ ok: true });
});

// ── Static ─────────────────────────────────────────────────────────────────────

const serverRoot =
  path.basename(__dirname) === "dist" ? path.dirname(__dirname) : __dirname;
const clientDist = path.join(serverRoot, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));

// ── Listen ─────────────────────────────────────────────────────────────────────

const proto = isHttps ? "https" : "http";
const localIP = getLocalIP();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ClipSpace server running on ${proto}://0.0.0.0:${PORT}`);
  console.log(`Local network: ${proto}://${localIP}:${PORT}`);
  if (!isHttps)
    console.log("TLS disabled — set TLS_CERT and TLS_KEY env vars to enable HTTPS");
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
