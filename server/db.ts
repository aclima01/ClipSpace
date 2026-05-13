import Database from "better-sqlite3";
import path from "path";
import { randomUUID } from "crypto";

const DB_PATH = path.join(__dirname, "clipspace.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    content TEXT NOT NULL,
    device_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  content: string;
  device_name: string;
  created_at: string;
}

export function listConversations(): Conversation[] {
  return db
    .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
    .all() as Conversation[];
}

export function createConversation(title: string): Conversation {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(id, title, now, now);
  return { id, title, created_at: now, updated_at: now };
}

export function updateConversationTitle(id: string, title: string): void {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?"
  ).run(title, now, id);
}

export function touchConversation(id: string): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
    now,
    id
  );
}

export function getMessages(conversationId: string): Message[] {
  return db
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 100"
    )
    .all(conversationId) as Message[];
}

export function createMessage(
  conversationId: string,
  content: string,
  deviceName: string
): Message {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO messages (id, conversation_id, content, device_name, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, conversationId, content, deviceName, now);
  touchConversation(conversationId);
  return {
    id,
    conversation_id: conversationId,
    content,
    device_name: deviceName,
    created_at: now,
  };
}

export interface SearchResult {
  conversations: Conversation[];
  messages: (Message & { conversation_title: string })[];
}

export function search(query: string): SearchResult {
  const term = `%${query}%`;
  const conversations = db
    .prepare(
      "SELECT * FROM conversations WHERE lower(title) LIKE lower(?) ORDER BY updated_at DESC LIMIT 8"
    )
    .all(term) as Conversation[];

  const messages = db
    .prepare(`
      SELECT m.*, c.title AS conversation_title
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE lower(m.content) LIKE lower(?)
      ORDER BY m.created_at DESC
      LIMIT 20
    `)
    .all(term) as (Message & { conversation_title: string })[];

  return { conversations, messages };
}

export function clearMessages(conversationId: string): void {
  db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
}

export function deleteConversation(id: string): void {
  db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

export default db;
