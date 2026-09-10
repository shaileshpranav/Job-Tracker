import { db } from "./db.ts";

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

/** API key for a provider: saved in the app first, else from .env. */
export function apiKey(provider: "anthropic" | "openrouter"): string | undefined {
  return get(`key:${provider}`) ?? (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENROUTER_API_KEY) ?? undefined;
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
  const provider = (get("provider") ?? process.env.LLM_PROVIDER ?? "anthropic") as Provider;
  const model = get(`model:${provider}`) ?? process.env.LLM_MODEL ?? DEFAULT_MODEL[provider];
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
    else if (input.apiKey?.trim()) set(`key:${provider}`, input.apiKey.trim());
  }
  if (input.ollamaHost !== undefined) {
    const h = input.ollamaHost.trim().replace(/\/$/, "");
    h ? set("ollamaHost", h) : del("ollamaHost");
  }
  return llmSettings();
}
