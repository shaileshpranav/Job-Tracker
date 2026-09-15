import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

export const ROOT = path.resolve(import.meta.dirname, "..");
// Overridable so a second instance (tests, a trial run) can keep its own data.
const dir = (env: string, fallback: string) => (process.env[env] ? path.resolve(process.env[env]!) : path.join(ROOT, fallback));
export const DATA_DIR = dir("DATA_DIR", "data");
export const APPS_DIR = dir("APPLICATIONS_DIR", "applications");
export const PROFILE_DIR = dir("PROFILE_DIR", "profile");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(APPS_DIR, { recursive: true });
fs.mkdirSync(PROFILE_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "tracker.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company     TEXT NOT NULL,
    role        TEXT NOT NULL,
    location    TEXT,
    url         TEXT,
    salary      TEXT,
    description TEXT,
    requirements TEXT,             -- JSON array of strings
    status      TEXT NOT NULL DEFAULT 'saved',
    applied_at  TEXT,
    notes       TEXT DEFAULT '',
    folder      TEXT,              -- relative path under applications/
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS documents (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL,   -- resume | cover_letter
    content        TEXT NOT NULL,   -- markdown
    file           TEXT,            -- path on disk
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS questions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    question       TEXT NOT NULL,
    answer         TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL,
    detail         TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.exec("PRAGMA foreign_keys = ON");
// Migrations for databases created before a column existed.
const cols = new Set((db.prepare("PRAGMA table_info(applications)").all() as { name: string }[]).map((c) => c.name));
if (!cols.has("source_text")) db.exec("ALTER TABLE applications ADD COLUMN source_text TEXT"); // raw page/pasted text the extraction ran on
if (!cols.has("fit_score")) db.exec("ALTER TABLE applications ADD COLUMN fit_score INTEGER; ALTER TABLE applications ADD COLUMN fit_json TEXT; ALTER TABLE applications ADD COLUMN fit_status TEXT");
if (!cols.has("resume_key")) db.exec("ALTER TABLE applications ADD COLUMN resume_key TEXT; ALTER TABLE applications ADD COLUMN resume_pinned INTEGER NOT NULL DEFAULT 0; ALTER TABLE applications ADD COLUMN fit_all TEXT");
if (!cols.has("next_action_at")) db.exec("ALTER TABLE applications ADD COLUMN next_action_at TEXT; ALTER TABLE applications ADD COLUMN next_action TEXT; ALTER TABLE applications ADD COLUMN followed_up_at TEXT");
const dcols = new Set((db.prepare("PRAGMA table_info(documents)").all() as { name: string }[]).map((c) => c.name));
if (!dcols.has("pages")) db.exec("ALTER TABLE documents ADD COLUMN pages INTEGER; ALTER TABLE documents ADD COLUMN pdf TEXT; ALTER TABLE documents ADD COLUMN pdf_hash TEXT");
if (!dcols.has("tex")) db.exec("ALTER TABLE documents ADD COLUMN tex TEXT"); // hand-edited LaTeX, overrides the generated TeX for the PDF
if (!dcols.has("original")) db.exec("ALTER TABLE documents ADD COLUMN original TEXT; UPDATE documents SET original = content"); // as generated, before any manual edits

export const STATUSES = ["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn"] as const;
export type Status = (typeof STATUSES)[number];

export interface Application {
  id: number; company: string; role: string; location: string | null; url: string | null;
  salary: string | null; description: string | null; requirements: string | null;
  status: Status; applied_at: string | null; notes: string; folder: string | null; source_text: string | null;
  fit_score: number | null; fit_json: string | null; fit_status: "pending" | "done" | "error" | null;
  next_action_at: string | null; next_action: string | null; followed_up_at: string | null;
  resume_key: string | null; resume_pinned: number; fit_all: string | null;
  created_at: string; updated_at: string;
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

export function logEvent(appId: number, kind: string, detail = "") {
  db.prepare("INSERT INTO events (application_id, kind, detail) VALUES (?, ?, ?)").run(appId, kind, detail);
}

export function touch(appId: number) {
  db.prepare("UPDATE applications SET updated_at = datetime('now') WHERE id = ?").run(appId);
}

/** Write a document to the application's folder and record it. */
export function saveDocument(app: Application, kind: string, content: string) {
  const dir = path.join(APPS_DIR, app.folder!);
  fs.mkdirSync(dir, { recursive: true });
  const filename = { cover_letter: "cover-letter.md", prep: "interview-prep.md" }[kind] ?? `${kind}.md`;
  const file = path.join(dir, filename);
  fs.writeFileSync(file, content);
  const info = db.prepare("INSERT INTO documents (application_id, kind, content, original, file) VALUES (?, ?, ?, ?, ?)")
    .run(app.id, kind, content, content, path.relative(ROOT, file));
  touch(app.id);
  return Number(info.lastInsertRowid);
}

export function getApp(id: number): Application | undefined {
  return db.prepare("SELECT * FROM applications WHERE id = ?").get(id) as Application | undefined;
}
