/**
 * Persistent task queue. Every model-backed action (capture, generate, fit,
 * answers, …) is a job: enqueued instantly, run by a worker pool, visible in
 * the Tasks panel. Jobs survive restarts (SQLite); ones interrupted mid-run
 * are marked failed on boot so they can be retried.
 */
import { db } from "./db.ts";
import { withProgress } from "./guard.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    type           TEXT NOT NULL,
    label          TEXT NOT NULL,
    application_id INTEGER,
    payload        TEXT NOT NULL DEFAULT '{}',
    status         TEXT NOT NULL DEFAULT 'queued',   -- queued | running | waiting | done | error | cancelled
    progress       TEXT,
    result         TEXT,
    error          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    started_at     TEXT,
    finished_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
`);
const jcols = new Set((db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name));
if (!jcols.has("need")) db.exec("ALTER TABLE jobs ADD COLUMN need TEXT"); // what the job is waiting for the user to supply
db.prepare("UPDATE jobs SET status = 'error', error = 'Interrupted by a server restart', finished_at = datetime('now') WHERE status = 'running'").run();

export type JobStatus = "queued" | "running" | "waiting" | "done" | "error" | "cancelled";
export interface Job {
  id: number; type: string; label: string; application_id: number | null; payload: string;
  status: JobStatus; progress: string | null; result: string | null; error: string | null; need: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
}

/**
 * Thrown by a handler that cannot continue without the user — e.g. a posting
 * behind a human-verification check. The job parks in `waiting` (nothing is
 * bypassed or solved automatically); the user completes the check in their own
 * browser and hands the page back, which resumes the job.
 */
export class NeedsYou extends Error {
  need: Record<string, unknown>;
  constructor(need: Record<string, unknown> & { message: string }) { super(need.message); this.need = need; }
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
    const existing = db.prepare("SELECT * FROM jobs WHERE type = ? AND application_id = ? AND status IN ('queued','running','waiting') AND payload = ? ORDER BY id LIMIT 1")
      .get(type, applicationId, JSON.stringify(payload)) as Job | undefined;
    if (existing) return existing;
  }
  const info = db.prepare("INSERT INTO jobs (type, label, application_id, payload) VALUES (?, ?, ?, ?)").run(type, label, applicationId, JSON.stringify(payload));
  queueMicrotask(pump);
  return getJob(Number(info.lastInsertRowid))!;
}

export function listJobs(limit = 40): Job[] {
  return db.prepare(`SELECT * FROM jobs WHERE status IN ('queued','running','waiting')
    UNION ALL SELECT * FROM (SELECT * FROM jobs WHERE status NOT IN ('queued','running','waiting') ORDER BY id DESC LIMIT ?)
    ORDER BY id DESC`).all(limit) as unknown as Job[];
}

/** Jobs parked waiting for the user, oldest first. */
export function waitingJobs(): Job[] {
  return db.prepare("SELECT * FROM jobs WHERE status = 'waiting' ORDER BY id").all() as unknown as Job[];
}

/** Hand a waiting job what it asked for (merged into its payload) and re-queue it. */
export function resumeJob(id: number, patch: object = {}): Job {
  const job = getJob(id);
  if (!job) throw new Error("Job not found");
  if (job.status !== "waiting") throw new Error(`Job is ${job.status}, not waiting for input`);
  const payload = { ...JSON.parse(job.payload), ...patch };
  db.prepare("UPDATE jobs SET payload = ?, status = 'queued', need = NULL, error = NULL, started_at = NULL WHERE id = ?").run(JSON.stringify(payload), id);
  queueMicrotask(pump);
  return getJob(id)!;
}

export function cancelJob(id: number): Job | undefined {
  const job = getJob(id);
  if (!job) return undefined;
  if (job.status === "queued" || job.status === "waiting") db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?").run(id);
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

/** Re-queue any waiting job whose `need` matches `pred` — used when the user hands over a page. */
export function resumeMatching(pred: (need: any, job: Job) => object | null): Job | undefined {
  for (const job of waitingJobs()) {
    const need = job.need ? JSON.parse(job.need) : {};
    const patch = pred(need, job);
    if (patch) return resumeJob(job.id, patch);
  }
  return undefined;
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
    const result = await withProgress(progress, () => handlers.get(job.type)!(JSON.parse(job.payload), job, progress));
    db.prepare("UPDATE jobs SET status = 'done', progress = NULL, result = ?, finished_at = datetime('now') WHERE id = ?").run(JSON.stringify(result ?? null), job.id);
  } catch (e: any) {
    if (e instanceof NeedsYou) {
      db.prepare("UPDATE jobs SET status = 'waiting', progress = NULL, need = ?, error = NULL WHERE id = ?").run(JSON.stringify(e.need), job.id);
      console.log(`[job ${job.id} ${job.type}] waiting for you: ${e.message}`);
      return;
    }
    const cancelled = e instanceof JobCancelled;
    db.prepare("UPDATE jobs SET status = ?, progress = NULL, error = ?, finished_at = datetime('now') WHERE id = ?").run(cancelled ? "cancelled" : "error", cancelled ? null : (e.message ?? String(e)), job.id);
    if (!cancelled) console.error(`[job ${job.id} ${job.type}]`, e.message ?? e);
  }
}

// Resume anything left queued from a previous run.
queueMicrotask(pump);
