/**
 * Migration: consolidate all pages per notebook into a single "Consolidado" page.
 *
 * For each notebook:
 *   - Creates a new page titled "Consolidado"
 *   - Moves every message from every existing page to it (order preserved via created_at)
 *   - Deletes the now-empty old pages and their AI sessions
 *
 * Run:  npx tsx migrate-consolidate.ts [--dry-run]
 * Safe: wrapped in a single transaction; rolls back on any error.
 */

import Database from "better-sqlite3";
import path from "path";
import { randomUUID } from "crypto";

const DRY_RUN = process.argv.includes("--dry-run");

const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, "clipspace.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

interface Notebook { id: string; title: string; created_at: string; updated_at: string }
interface Page     { id: string; notebook_id: string; title: string; created_at: string; updated_at: string }

const notebooks = db.prepare("SELECT * FROM notebooks ORDER BY created_at ASC").all() as Notebook[];

if (notebooks.length === 0) {
  console.log("Nenhum notebook encontrado. Nada a fazer.");
  process.exit(0);
}

console.log(`Notebooks encontrados: ${notebooks.length}`);
if (DRY_RUN) console.log("⚠  DRY RUN — nenhuma alteração será gravada.\n");

const migrate = db.transaction(() => {
  let totalMoved = 0;
  let totalPagesRemoved = 0;

  for (const nb of notebooks) {
    const pages = db
      .prepare("SELECT * FROM pages WHERE notebook_id = ? ORDER BY created_at ASC")
      .all(nb.id) as Page[];

    if (pages.length === 0) {
      console.log(`  [${nb.title}] sem pages — pulando`);
      continue;
    }

    const oldPageIds = pages.map((p) => p.id);
    const placeholders = oldPageIds.map(() => "?").join(", ");

    const msgCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE page_id IN (${placeholders})`).get(...oldPageIds) as { n: number }
    ).n;

    if (msgCount === 0) {
      console.log(`  [${nb.title}] ${pages.length} page(s) sem mensagens — pulando`);
      continue;
    }

    // Timestamps: oldest message → created_at, newest → updated_at
    const oldest = db
      .prepare(`SELECT MIN(created_at) AS ts FROM messages WHERE page_id IN (${placeholders})`)
      .get(...oldPageIds) as { ts: string };
    const newest = db
      .prepare(`SELECT MAX(created_at) AS ts FROM messages WHERE page_id IN (${placeholders})`)
      .get(...oldPageIds) as { ts: string };

    const newPageId = randomUUID();
    const newPageCreatedAt = oldest.ts ?? new Date().toISOString();
    const newPageUpdatedAt = newest.ts ?? new Date().toISOString();

    console.log(
      `  [${nb.title}] ${pages.length} page(s), ${msgCount} mensagem(ns) → nova page "${newPageId}" (Consolidado)`
    );

    if (!DRY_RUN) {
      db.prepare(
        "INSERT INTO pages (id, notebook_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).run(newPageId, nb.id, "Consolidado", newPageCreatedAt, newPageUpdatedAt);

      db.prepare(
        `UPDATE messages SET page_id = ? WHERE page_id IN (${placeholders})`
      ).run(newPageId, ...oldPageIds);

      db.prepare(
        `DELETE FROM ai_sessions WHERE page_id IN (${placeholders})`
      ).run(...oldPageIds);

      db.prepare(
        `DELETE FROM pages WHERE id IN (${placeholders})`
      ).run(...oldPageIds);

      // Keep notebook's updated_at in sync
      db.prepare("UPDATE notebooks SET updated_at = ? WHERE id = ?").run(newPageUpdatedAt, nb.id);
    }

    totalMoved += msgCount;
    totalPagesRemoved += pages.length;
  }

  console.log(`\nResumo: ${totalMoved} mensagem(ns) movida(s), ${totalPagesRemoved} page(s) removida(s).`);
  if (DRY_RUN) console.log("DRY RUN concluído — banco não alterado.");
});

try {
  migrate();
} catch (err) {
  console.error("Erro durante a migration — rollback automático:", err);
  process.exit(1);
}
