import Database from "better-sqlite3";
import path from "path";
import { randomUUID } from "crypto";

const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, "clipspace.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

initializeDB();

// ── Task ID counter ────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS task_counter (
    id INTEGER PRIMARY KEY AUTOINCREMENT
  );
`);

// ── Briefing ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS briefing (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    content      TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );
`);

// Regex: matches checkboxes that do NOT already have a #NNNN id
// Matches checkboxes not already followed by #TK-NNN or legacy #NNN
const UNTAGGED_TODO_RE = /^([-*+]\s+\[([ x])\])(?!\s+#(?:TK-)?\d)/gm;

function nextTaskId(): string {
  db.prepare("INSERT INTO task_counter DEFAULT VALUES").run();
  const { id } = db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
  return `#TK-${String(id).padStart(4, "0")}`;
}

function tagUntaggedTodos(content: string): string {
  if (!UNTAGGED_TODO_RE.test(content)) return content;
  UNTAGGED_TODO_RE.lastIndex = 0;
  return content.replace(UNTAGGED_TODO_RE, (_, prefix) => `${prefix} ${nextTaskId()}`);
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Notebook {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  notebook_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface NotebookWithPages extends Notebook {
  pages: Page[];
}

export interface Message {
  id: string;
  page_id: string;
  content: string;
  device_name: string;
  created_at: string;
  pinned: boolean;
}

// ── Schema init & migration ────────────────────────────────────────────────────

function initializeDB() {
  const hasNotebooks = !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notebooks'")
    .get();

  if (hasNotebooks) return;

  const hasConversations = !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'")
    .get();

  if (hasConversations) {
    runMigration();
  } else {
    createSchema();
  }
}

// ai_sessions is always created/ensured regardless of migration path
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_sessions (
    page_id    TEXT PRIMARY KEY,
    messages   TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// ai_instructions column on notebooks — added post-migration; safe to run multiple times
try {
  db.exec("ALTER TABLE notebooks ADD COLUMN ai_instructions TEXT NOT NULL DEFAULT ''");
} catch { /* column already exists */ }

// pinned column on messages
try {
  db.exec("ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
} catch { /* column already exists */ }

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pages (
      id          TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id),
      title       TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      page_id     TEXT NOT NULL REFERENCES pages(id),
      content     TEXT NOT NULL,
      device_name TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
  `);
}

function runMigration() {
  console.log("[db] Migrating: conversations → notebooks + pages");

  db.pragma("foreign_keys = OFF");

  db.exec(`
    CREATE TABLE notebooks (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE pages (
      id          TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id),
      title       TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `);

  const conversations = db.prepare("SELECT * FROM conversations").all() as Array<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
  }>;

  const insertNotebook = db.prepare(
    "INSERT INTO notebooks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
  );
  const insertPage = db.prepare(
    "INSERT INTO pages (id, notebook_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  );

  for (const conv of conversations) {
    const notebookId = randomUUID();
    // Page reuses the conversation ID so messages.conversation_id maps directly to page.id
    insertNotebook.run(notebookId, conv.title, conv.created_at, conv.updated_at);
    insertPage.run(conv.id, notebookId, "Index", conv.created_at, conv.updated_at);
  }

  // Recreate messages table with the correct FK (page_id → pages)
  db.exec(`
    CREATE TABLE messages_new (
      id          TEXT PRIMARY KEY,
      page_id     TEXT NOT NULL REFERENCES pages(id),
      content     TEXT NOT NULL,
      device_name TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    INSERT INTO messages_new SELECT id, conversation_id, content, device_name, created_at FROM messages;
    DROP TABLE messages;
    ALTER TABLE messages_new RENAME TO messages;
    DROP TABLE conversations;
  `);

  db.pragma("foreign_keys = ON");

  console.log(`[db] Migrated ${conversations.length} conversation(s) → notebooks.`);
}

// ── Notebooks ──────────────────────────────────────────────────────────────────

export function listNotebooks(): NotebookWithPages[] {
  const notebooks = db
    .prepare("SELECT * FROM notebooks ORDER BY updated_at DESC")
    .all() as Notebook[];

  const allPages = db
    .prepare("SELECT * FROM pages ORDER BY updated_at DESC")
    .all() as Page[];

  const byNotebook = new Map<string, Page[]>();
  for (const page of allPages) {
    const arr = byNotebook.get(page.notebook_id) ?? [];
    arr.push(page);
    byNotebook.set(page.notebook_id, arr);
  }

  return notebooks.map((nb) => ({ ...nb, pages: byNotebook.get(nb.id) ?? [] }));
}

export function createNotebook(title: string): Notebook {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO notebooks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(id, title, now, now);
  return { id, title, created_at: now, updated_at: now };
}

export function updateNotebookTitle(id: string, title: string): void {
  db.prepare("UPDATE notebooks SET title = ?, updated_at = ? WHERE id = ?").run(
    title,
    new Date().toISOString(),
    id
  );
}

export function deleteNotebook(id: string): void {
  db.prepare(
    "DELETE FROM messages WHERE page_id IN (SELECT id FROM pages WHERE notebook_id = ?)"
  ).run(id);
  db.prepare("DELETE FROM pages WHERE notebook_id = ?").run(id);
  db.prepare("DELETE FROM notebooks WHERE id = ?").run(id);
}

function touchNotebook(id: string): void {
  db.prepare("UPDATE notebooks SET updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id
  );
}

// ── Pages ──────────────────────────────────────────────────────────────────────

export function getPage(id: string): Page | null {
  return (db.prepare("SELECT * FROM pages WHERE id = ?").get(id) as Page) ?? null;
}

export function createPage(notebookId: string, title: string): Page {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO pages (id, notebook_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, notebookId, title, now, now);
  touchNotebook(notebookId);
  return { id, notebook_id: notebookId, title, created_at: now, updated_at: now };
}

export function updatePageTitle(id: string, title: string): void {
  db.prepare("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?").run(
    title,
    new Date().toISOString(),
    id
  );
}

export function deletePage(id: string): string | null {
  const row = db.prepare("SELECT notebook_id FROM pages WHERE id = ?").get(id) as
    | { notebook_id: string }
    | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM messages WHERE page_id = ?").run(id);
  db.prepare("DELETE FROM ai_sessions WHERE page_id = ?").run(id);
  db.prepare("DELETE FROM pages WHERE id = ?").run(id);
  return row.notebook_id;
}

function touchPage(id: string): string {
  const now = new Date().toISOString();
  db.prepare("UPDATE pages SET updated_at = ? WHERE id = ?").run(now, id);
  const row = db.prepare("SELECT notebook_id FROM pages WHERE id = ?").get(id) as
    | { notebook_id: string }
    | undefined;
  const notebookId = row?.notebook_id ?? "";
  if (notebookId) touchNotebook(notebookId);
  return now;
}

// ── Messages ───────────────────────────────────────────────────────────────────

export function getMessage(id: string): Message | null {
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
    | (Omit<Message, "pinned"> & { pinned: number })
    | undefined;
  if (!row) return null;
  return { ...row, pinned: row.pinned === 1 };
}

export function getMessages(pageId: string): Message[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE page_id = ? ORDER BY created_at ASC LIMIT 100")
    .all(pageId) as Array<Omit<Message, "pinned"> & { pinned: number }>;
  return rows.map((r) => ({ ...r, pinned: r.pinned === 1 }));
}

export function createMessage(
  pageId: string,
  content: string,
  deviceName: string
): Message {
  const now = new Date().toISOString();
  const id = randomUUID();
  const tagged = tagUntaggedTodos(content);
  db.prepare(
    "INSERT INTO messages (id, page_id, content, device_name, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, pageId, tagged, deviceName, now);
  touchPage(pageId);
  return { id, page_id: pageId, content: tagged, device_name: deviceName, created_at: now, pinned: false };
}

export function pinMessage(id: string, pinned: boolean): string | null {
  const row = db.prepare("SELECT page_id FROM messages WHERE id = ?").get(id) as
    | { page_id: string }
    | undefined;
  if (!row) return null;
  db.prepare("UPDATE messages SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
  return row.page_id;
}

export function updateMessage(id: string, content: string): string | null {
  const row = db.prepare("SELECT page_id FROM messages WHERE id = ?").get(id) as
    | { page_id: string }
    | undefined;
  if (!row) return null;
  const tagged = tagUntaggedTodos(content);
  db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(tagged, id);
  return row.page_id;
}

export function deleteMessage(id: string): string | null {
  const row = db.prepare("SELECT page_id FROM messages WHERE id = ?").get(id) as
    | { page_id: string }
    | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM messages WHERE id = ?").run(id);
  return row.page_id;
}

export function clearMessages(pageId: string): void {
  db.prepare("DELETE FROM messages WHERE page_id = ?").run(pageId);
}

// ── Home ───────────────────────────────────────────────────────────────────────

export interface HomeData {
  stats: {
    messagesToday: number;
    openTodos: number;
    totalPages: number;
    totalNotebooks: number;
  };
  feed: (Message & { page_title: string; notebook_id: string; notebook_title: string })[];
}

export function getHomeData(): HomeData {
  const n = (q: string) =>
    (db.prepare(q).get() as { n: number }).n;

  // Count open todo items across all messages
  const allContents = db.prepare("SELECT content FROM messages").all() as { content: string }[];
  const openTodos = allContents.reduce((sum, { content }) => {
    return sum + (content.match(/^[-*+]\s+\[ \]/gm)?.length ?? 0);
  }, 0);

  const stats = {
    messagesToday: n("SELECT COUNT(*) as n FROM messages WHERE date(created_at) = date('now')"),
    openTodos,
    totalPages: n("SELECT COUNT(*) as n FROM pages"),
    totalNotebooks: n("SELECT COUNT(*) as n FROM notebooks"),
  };

  const feed = db.prepare(`
    SELECT m.*, p.title AS page_title, p.notebook_id, n.title AS notebook_title
    FROM messages m
    JOIN pages p ON m.page_id = p.id
    JOIN notebooks n ON p.notebook_id = n.id
    ORDER BY m.created_at DESC
    LIMIT 40
  `).all() as (Message & { page_title: string; notebook_id: string; notebook_title: string })[];

  return { stats, feed };
}

// ── Task lookup ────────────────────────────────────────────────────────────────

export function findTaskMessage(taskId: string): { pageId: string; messageId: string } | null {
  const row = db
    .prepare("SELECT id, page_id FROM messages WHERE content LIKE ? LIMIT 1")
    .get(`%${taskId}%`) as { id: string; page_id: string } | undefined;
  if (!row) return null;
  return { pageId: row.page_id, messageId: row.id };
}

// ── Search ─────────────────────────────────────────────────────────────────────

export interface SearchResult {
  notebooks: Notebook[];
  pages: (Page & { notebook_title: string })[];
  messages: (Message & { page_title: string; notebook_id: string; notebook_title: string })[];
}

export function search(query: string): SearchResult {
  const term = `%${query}%`;

  const notebooks = db
    .prepare(
      "SELECT * FROM notebooks WHERE lower(title) LIKE lower(?) ORDER BY updated_at DESC LIMIT 5"
    )
    .all(term) as Notebook[];

  const pages = db
    .prepare(`
      SELECT p.*, n.title AS notebook_title
      FROM pages p JOIN notebooks n ON p.notebook_id = n.id
      WHERE lower(p.title) LIKE lower(?)
      ORDER BY p.updated_at DESC LIMIT 8
    `)
    .all(term) as (Page & { notebook_title: string })[];

  const messages = db
    .prepare(`
      SELECT m.*, p.title AS page_title, p.notebook_id, n.title AS notebook_title
      FROM messages m
      JOIN pages p ON m.page_id = p.id
      JOIN notebooks n ON p.notebook_id = n.id
      WHERE lower(m.content) LIKE lower(?)
      ORDER BY m.created_at DESC LIMIT 20
    `)
    .all(term) as (Message & { page_title: string; notebook_id: string; notebook_title: string })[];

  return { notebooks, pages, messages };
}

// ── Morning Briefing ───────────────────────────────────────────────────────────

export interface TodoGroup {
  notebookId: string;
  notebookTitle: string;
  pageId: string;
  pageTitle: string;
  pageUpdatedAt: string;
  items: string[];
}

export interface RecentPage {
  notebookId: string;
  notebookTitle: string;
  pageId: string;
  pageTitle: string;
  updatedAt: string;
  newMessages: number;
}

export interface BriefingData {
  openTodos: TodoGroup[];
  recentPages: RecentPage[];
}

export function getBriefingData(since: string): BriefingData {
  // Collect all messages that contain at least one open todo
  const rows = db.prepare(`
    SELECT m.id, m.content, m.page_id,
           p.title AS page_title, p.notebook_id, p.updated_at AS page_updated_at,
           n.title AS notebook_title
    FROM messages m
    JOIN pages p ON m.page_id = p.id
    JOIN notebooks n ON p.notebook_id = n.id
    WHERE m.content LIKE '%- [ ]%' OR m.content LIKE '%* [ ]%' OR m.content LIKE '%+ [ ]%'
    ORDER BY p.updated_at DESC
  `).all() as Array<{ content: string; page_id: string; page_title: string; notebook_id: string; notebook_title: string; page_updated_at: string }>;

  const groupMap = new Map<string, TodoGroup>();
  for (const row of rows) {
    const re = /^[-*+]\s+\[ \]\s+(.+)$/gm;
    const items: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(row.content)) !== null) items.push(m[1].trim());
    if (items.length === 0) continue;
    if (!groupMap.has(row.page_id)) {
      groupMap.set(row.page_id, {
        notebookId: row.notebook_id,
        notebookTitle: row.notebook_title,
        pageId: row.page_id,
        pageTitle: row.page_title,
        pageUpdatedAt: row.page_updated_at,
        items: [],
      });
    }
    groupMap.get(row.page_id)!.items.push(...items);
  }

  // Pages with activity since `since`
  const recentRows = db.prepare(`
    SELECT p.id, p.title, p.updated_at, p.notebook_id,
           n.title AS notebook_title,
           COUNT(m.id) AS new_messages
    FROM pages p
    JOIN notebooks n ON p.notebook_id = n.id
    LEFT JOIN messages m ON m.page_id = p.id AND m.created_at > ?
    WHERE p.updated_at > ?
    GROUP BY p.id
    ORDER BY p.updated_at DESC
    LIMIT 15
  `).all(since, since) as Array<{
    id: string; title: string; updated_at: string;
    notebook_id: string; notebook_title: string; new_messages: number;
  }>;

  return {
    openTodos: [...groupMap.values()],
    recentPages: recentRows.map((r) => ({
      notebookId: r.notebook_id,
      notebookTitle: r.notebook_title,
      pageId: r.id,
      pageTitle: r.title,
      updatedAt: r.updated_at,
      newMessages: r.new_messages,
    })),
  };
}

// ── Notebook AI instructions ───────────────────────────────────────────────────

export function getNotebookAiInstructions(notebookId: string): string {
  const row = db
    .prepare("SELECT ai_instructions FROM notebooks WHERE id = ?")
    .get(notebookId) as { ai_instructions: string } | undefined;
  return row?.ai_instructions ?? "";
}

export function updateNotebookAiInstructions(notebookId: string, instructions: string): void {
  db.prepare("UPDATE notebooks SET ai_instructions = ? WHERE id = ?").run(instructions, notebookId);
}

// ── AI Sessions ────────────────────────────────────────────────────────────────

export function getAISession(pageId: string): unknown[] | null {
  const row = db
    .prepare("SELECT messages FROM ai_sessions WHERE page_id = ?")
    .get(pageId) as { messages: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.messages) as unknown[]; } catch { return null; }
}

export function saveAISession(pageId: string, messages: unknown[]): void {
  db.prepare(`
    INSERT INTO ai_sessions (page_id, messages, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (page_id) DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at
  `).run(pageId, JSON.stringify(messages), new Date().toISOString());
}

export function clearAISession(pageId: string): void {
  db.prepare("DELETE FROM ai_sessions WHERE page_id = ?").run(pageId);
}

// ── Briefing persistence ───────────────────────────────────────────────────────

export function saveBriefing(content: string, generatedAt: string): void {
  db.prepare(`
    INSERT INTO briefing (id, content, generated_at) VALUES (1, ?, ?)
    ON CONFLICT (id) DO UPDATE SET content = excluded.content, generated_at = excluded.generated_at
  `).run(content, generatedAt);
}

export function loadBriefing(): { content: string; generatedAt: string } | null {
  const row = db.prepare("SELECT content, generated_at FROM briefing WHERE id = 1").get() as
    { content: string; generated_at: string } | undefined;
  if (!row) return null;
  return { content: row.content, generatedAt: row.generated_at };
}

export default db;
