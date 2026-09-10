/**
 * Persistent task queue. Every model-backed action (capture, generate, fit,
 * answers, …) is a job: enqueued instantly, run by a worker pool, visible in
 * the Tasks panel. Jobs survive restarts (SQLite); ones interrupted mid-run
 * are marked failed on boot so they can be retried.
 */
import { db } from "./db.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    type           TEXT NOT NULL,
    label          TEXT NOT NULL,
    application_id INTEGER,
    payload        TEXT NOT NULL DEFAULT '{}',
    status         TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | error | cancelled
    progress       TEXT,
    result         TEXT,
    error          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    started_at     TEXT,
    finished_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
`);
db.prepare("UPDATE jobs SET status = 'error', error = 'Interrupted by a server restart', finished_at = datetime('now') WHERE status = 'running'").run();

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export interface Job {
  id: number; type: string; label: string; application_id: number | null; payload: string;
  status: JobStatus; progress: string | null; result: string | null; error: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
}
export type Progress = (msg: string) => void;
type Handler = (payload: any, job: Job, progress: Progress) => Promise<unknown>;

const handlers = new Map<string, Handler>();
export function registerJob(type: string, handler: Handler) { handlers.set(type, handler); }

const CONCURRENCY = Math.max(1, Number(process.env.JOB_CONCURRENCY ?? 1)); // 1: local models are one-at-a-time anyway
let running = 0;
let cancelRequested = new Set<number>();

export function getJob(id: number): Job | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
}

/** Queue a job. A queued/running job of the same type for the same application is returned instead of duplicated. */
export function enqueue(type: string, label: string, payload: object = {}, applicationId: number | null = null): Job {
  if (!handlers.has(type)) throw new Error(`No handler for job type ${type}`);
  if (applicationId !== null) {
    const existing = db.prepare("SELECT * FROM jobs WHERE type = ? AND application_id = ? AND status IN ('queued','running') AND payload = ? ORDER BY id LIMIT 1")
      .get(type, applicationId, JSON.stringify(payload)) as Job | undefined;
    if (existing) return existing;
  }
  const info = db.prepare("INSERT INTO jobs (type, label, application_id, payload) VALUES (?, ?, ?, ?)").run(type, label, applicationId, JSON.stringify(payload));
  queueMicrotask(pump);
  return getJob(Number(info.lastInsertRowid))!;
}

export function listJobs(limit = 40): Job[] {
  return db.prepare(`SELECT * FROM jobs WHERE status IN ('queued','running')
    UNION ALL SELECT * FROM (SELECT * FROM jobs WHERE status NOT IN ('queued','running') ORDER BY id DESC LIMIT ?)
    ORDER BY id DESC`).all(limit) as unknown as Job[];
}

export function cancelJob(id: number): Job | undefined {
  const job = getJob(id);
  if (!job) return undefined;
  if (job.status === "queued") db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?").run(id);
  else if (job.status === "running") cancelRequested.add(id); // honoured at the next progress checkpoint
  return getJob(id);
}

export function retryJob(id: number): Job {
  const job = getJob(id);
  if (!job) throw new Error("Job not found");
  return enqueue(job.type, job.label, JSON.parse(job.payload), job.application_id);
}

export function clearFinishedJobs() {
  db.prepare("DELETE FROM jobs WHERE status IN ('done','error','cancelled')").run();
}

export class JobCancelled extends Error { constructor() { super("Cancelled"); } }

function pump() {
  while (running < CONCURRENCY) {
    const next = db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get() as Job | undefined;
    if (!next) return;
    running++;
    db.prepare("UPDATE jobs SET status = 'running', started_at = datetime('now') WHERE id = ?").run(next.id);
    runJob(getJob(next.id)!).finally(() => { running--; pump(); });
  }
}

async function runJob(job: Job) {
  const progress: Progress = (msg) => {
    if (cancelRequested.has(job.id)) { cancelRequested.delete(job.id); throw new JobCancelled(); }
    db.prepare("UPDATE jobs SET progress = ? WHERE id = ?").run(msg, job.id);
  };
  try {
    const result = await handlers.get(job.type)!(JSON.parse(job.payload), job, progress);
    db.prepare("UPDATE jobs SET status = 'done', progress = NULL, result = ?, finished_at = datetime('now') WHERE id = ?").run(JSON.stringify(result ?? null), job.id);
  } catch (e: any) {
    const cancelled = e instanceof JobCancelled;
    db.prepare("UPDATE jobs SET status = ?, progress = NULL, error = ?, finished_at = datetime('now') WHERE id = ?").run(cancelled ? "cancelled" : "error", cancelled ? null : (e.message ?? String(e)), job.id);
    if (!cancelled) console.error(`[job ${job.id} ${job.type}]`, e.message ?? e);
  }
}

// Resume anything left queued from a previous run.
queueMicrotask(pump);
