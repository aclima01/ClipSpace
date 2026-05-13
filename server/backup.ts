import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(__dirname, "clipspace.db");
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(__dirname, "..", "backups");
const KEEP = parseInt(process.env.BACKUP_KEEP ?? "30", 10);

function run() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[backup] database not found: ${DB_PATH}`);
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19); // 2026-05-13T17-00-00

  const dest = path.join(BACKUP_DIR, `clipspace-${timestamp}.db`);

  // .backup() is an online, consistent snapshot — safe while the server is running
  const db = new Database(DB_PATH, { readonly: true });
  db.backup(dest)
    .then(() => {
      db.close();
      console.log(`[backup] ok → ${dest}`);
      rotate();
    })
    .catch((err: unknown) => {
      db.close();
      console.error("[backup] failed:", err);
      process.exit(1);
    });
}

function rotate() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("clipspace-") && f.endsWith(".db"))
    .sort(); // ascending — oldest first

  const excess = files.length - KEEP;
  if (excess <= 0) return;

  files.slice(0, excess).forEach((f) => {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
    console.log(`[backup] rotated out: ${f}`);
  });
}

run();
