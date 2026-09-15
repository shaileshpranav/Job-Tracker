import { db } from "./db.ts";
import { encrypt, decrypt, looksEncrypted, hashPassword, verifyPassword, timingSafeEqualStr } from "./crypto.ts";

db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

export const PROVIDERS = ["anthropic", "openrouter", "ollama"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Work the app sends to a model; each can be routed to its own provider/model. */
export const TASKS = {
  capture: "Capture & extract job postings",
  fit: "Fit score & gap list",
  import: "Import resume (PDF/DOCX → Markdown)",
  resume: "Tailored resume",
  cover_letter: "Cover letter",
  questions: "Application answers",
  learn: "Learn formatting from my edits",
  prep: "Interview prep",
  feed: "Feed triage (quick fit score)",
} as const;

/** Formatting preferences learned from the user's manual edits, per document kind. */
export type StyleKind = "resume" | "cover_letter";
export function getStyle(kind: StyleKind): string { return get(`style:${kind}`) ?? ""; }
export function saveStyle(kind: StyleKind, text: string | null) {
  if (!["resume", "cover_letter"].includes(kind)) throw new Error("Unknown kind");
  text?.trim() ? set(`style:${kind}`, text.trim()) : del(`style:${kind}`);
}
export type Task = keyof typeof TASKS;
export interface Route { provider: Provider; model: string }

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-opus-5",
  openrouter: "anthropic/claude-opus-5",
  ollama: "llama3.1",
};

function get(key: string): string | undefined {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}
function set(key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
function del(key: string) {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

/** API key for a provider: saved in the app first (encrypted at rest), else from .env. */
export function apiKey(provider: "anthropic" | "openrouter"): string | undefined {
  const raw = get(`key:${provider}`);
  if (raw) {
    if (looksEncrypted(raw)) {
      try { return decrypt(raw); } catch { /* corrupted (e.g. secret.key lost) — treat as unset */ }
    } else {
      set(`key:${provider}`, encrypt(raw)); // migrate a key saved before encryption existed
      return raw;
    }
  }
  return (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENROUTER_API_KEY) ?? undefined;
}

const mask = (k?: string) => (k ? `${k.slice(0, 7)}…${k.slice(-4)}` : null);

/** The provider/model a task actually runs on: its own route if set, else the default. */
export function taskRoute(task?: Task): Route {
  const s = llmSettings();
  const own = task ? s.tasks[task] : null;
  return own ?? { provider: s.provider, model: s.model };
}

export function saveTaskRoute(task: Task, route: Route | null) {
  if (!(task in TASKS)) throw new Error(`Unknown task: ${task}`);
  if (!route) { del(`task:${task}`); return llmSettings(); }
  if (!PROVIDERS.includes(route.provider)) throw new Error(`Unknown provider: ${route.provider}`);
  set(`task:${task}`, JSON.stringify({ provider: route.provider, model: route.model.trim() || DEFAULT_MODEL[route.provider] }));
  return llmSettings();
}

/** Effective LLM config: app-saved settings win, then .env, then defaults. */
export function llmSettings() {
  const envProvider = (PROVIDERS as readonly string[]).includes(process.env.LLM_PROVIDER ?? "") ? (process.env.LLM_PROVIDER as Provider) : "anthropic";
  const provider = (get("provider") ?? envProvider) as Provider;
  // LLM_MODEL only makes sense for the provider it was written for.
  const envModel = provider === envProvider ? process.env.LLM_MODEL : undefined;
  const model = get(`model:${provider}`) ?? envModel ?? DEFAULT_MODEL[provider];
  const tasks = Object.fromEntries(
    Object.keys(TASKS).map((t) => { const v = get(`task:${t}`); return [t, v ? (JSON.parse(v) as Route) : null]; }),
  ) as Record<Task, Route | null>;
  return {
    provider,
    model,
    tasks,
    taskNames: TASKS,
    ollamaHost: (get("ollamaHost") ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, ""),
    keys: {
      anthropic: mask(apiKey("anthropic")),
      openrouter: mask(apiKey("openrouter")),
    },
    keySource: {
      anthropic: get("key:anthropic") ? "app" : process.env.ANTHROPIC_API_KEY ? "env" : null,
      openrouter: get("key:openrouter") ? "app" : process.env.OPENROUTER_API_KEY ? "env" : null,
    },
  };
}

export function saveLlmSettings(input: { provider?: string; model?: string; apiKey?: string; clearKey?: boolean; ollamaHost?: string }) {
  if (input.provider) {
    if (!PROVIDERS.includes(input.provider as Provider)) throw new Error(`Unknown provider: ${input.provider}`);
    set("provider", input.provider);
  }
  const provider = llmSettings().provider;
  if (input.model?.trim()) set(`model:${provider}`, input.model.trim());
  if (provider !== "ollama") {
    if (input.clearKey) del(`key:${provider}`);
    else if (input.apiKey?.trim()) set(`key:${provider}`, encrypt(input.apiKey.trim()));
  }
  if (input.ollamaHost !== undefined) {
    const h = input.ollamaHost.trim().replace(/\/$/, "");
    h ? set("ollamaHost", h) : del("ollamaHost");
  }
  return llmSettings();
}

/**
 * App login: unset by default (matches today's no-auth behaviour). Set a
 * password here or via AUTH_PASSWORD in .env to require it on every request —
 * the app-saved one (hashed, never stored raw) wins if both are set.
 */
export function authStatus(): { enabled: boolean; source: "app" | "env" | null } {
  const appSet = Boolean(get("auth:passwordHash"));
  return { enabled: appSet || Boolean(process.env.AUTH_PASSWORD), source: appSet ? "app" : process.env.AUTH_PASSWORD ? "env" : null };
}
export function authRequired(): boolean {
  return authStatus().enabled;
}
export function verifyAuthPassword(password: string): boolean {
  const pw = password.trim(); // stored passwords are trimmed too
  const hash = get("auth:passwordHash");
  if (hash) return verifyPassword(pw, hash);
  if (process.env.AUTH_PASSWORD) return timingSafeEqualStr(pw, process.env.AUTH_PASSWORD.trim());
  return false;
}
/** Changes with every password set/clear so existing sessions stop verifying. */
export function authGeneration(): string {
  return `${get("auth:generation") ?? "0"}:${get("auth:passwordHash") ? "app" : process.env.AUTH_PASSWORD ? "env" : "none"}`;
}
export function setAuthPassword(password: string | null) {
  if (password === null) del("auth:passwordHash");
  else {
    if (password.trim().length < 8) throw new Error("Password must be at least 8 characters");
    set("auth:passwordHash", hashPassword(password.trim()));
  }
  set("auth:generation", String(Number(get("auth:generation") ?? "0") + 1));
  return authStatus();
}
