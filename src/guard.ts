/**
 * Model quality guard. Small or free models sometimes return structurally
 * valid JSON full of junk ("O-7", "{"label": …", empty answers). Every
 * structured result is sanity-checked here; junk is recorded against the
 * model and the call is retried once on a stronger fallback model.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "./db.ts";
import { llmSettings, taskRoute, apiKey, PROVIDERS, type Route, type Task } from "./settings.ts";

// ---------- progress channel (jobs set it; the guard reports retries through it) ----------
const als = new AsyncLocalStorage<(msg: string) => void>();
export const withProgress = <T>(progress: (msg: string) => void, fn: () => Promise<T>) => als.run(progress, fn);
const report = (msg: string) => { als.getStore()?.(msg); console.log(`[guard] ${msg}`); };

// ---------- junk detection ----------
const PLACEHOLDER = /^(?:[a-z]-?\d{1,3}|string|text|value|label|name|title|company|role|location|salary|description|unknown|n\/?a|tbd|tba|null|none|undefined|lorem ipsum.*|\.\.\.|-+|_+|x+|xxx.*|placeholder|example|sample|test|insert .*|\[.*\]|<.*>|\{.*\})$/i;
export function looksLikePlaceholder(v: string): boolean {
  const t = v.trim();
  if (!t) return false; // emptiness is judged per field
  if (PLACEHOLDER.test(t)) return true;
  if (/^[{[]\s*"/.test(t) || /"\s*:\s*"/.test(t)) return true;           // JSON leaked into a string
  if (/\{\{.*\}\}|<\/?[a-z]+>/i.test(t) && t.length < 80) return true;     // template / tag residue
  if (/(\b\S+\b)(?:\s+\1\b){4,}/.test(t)) return true;                    // "0 0 0 0 0", "the the the"
  return false;
}
/** Every string in a result, with a dotted path. */
function strings(v: unknown, path = ""): [string, string][] {
  if (typeof v === "string") return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => strings(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => strings(x, path ? `${path}.${k}` : k));
  return [];
}

export type Check = (result: any, ctx: { sourceLength?: number }) => string[];
/** Generic problems any structured result can have. */
const generic: Check = (r) => {
  const out: string[] = [];
  for (const [path, s] of strings(r)) if (looksLikePlaceholder(s)) out.push(`${path} = "${s.slice(0, 40)}"`);
  return out.slice(0, 6);
};
export const checks = {
  job: ((r, ctx) => {
    const p = generic(r, ctx);
    if (!r.company?.trim() || r.company.trim().length < 2) p.push("company is empty");
    if (!r.role?.trim() || r.role.trim().length < 3) p.push("role is empty");
    const desc = String(r.description ?? "");
    if (desc.trim().length < 80 && (ctx.sourceLength ?? 0) > 800) p.push(`description is ${desc.trim().length} chars from a ${ctx.sourceLength}-char page`);
    if (Array.isArray(r.requirements) && r.requirements.length && r.requirements.every((x: string) => looksLikePlaceholder(x))) p.push("requirements are placeholders");
    return p;
  }) as Check,
  fit: ((r, ctx) => {
    const p = generic(r, ctx);
    if (!String(r.verdict ?? "").trim() || String(r.verdict).trim().length < 15) p.push("verdict is empty");
    if (!String(r.advice ?? "").trim()) p.push("advice is empty");
    return p;
  }) as Check,
  quickfit: ((r, ctx) => { const p = generic(r, ctx); if (!String(r.reason ?? "").trim() || String(r.reason).trim().length < 10) p.push("reason is empty"); return p; }) as Check,
  answers: ((r, ctx) => {
    const p = generic(r, ctx);
    const answers = Array.isArray(r.answers) ? r.answers : [];
    if (!answers.length) p.push("no answers");
    for (const [i, a] of answers.entries()) if (String(a.answer ?? "").trim().length < 40) p.push(`answers[${i}] is too short`);
    return p;
  }) as Check,
  style: ((r, ctx) => { const p = generic(r, ctx); if (!Array.isArray(r.rules) || !r.rules.length) p.push("no rules"); return p; }) as Check,
  titles: ((r, ctx) => { const p = generic(r, ctx); if (!Array.isArray(r.titles) || !r.titles.length) p.push("no titles"); return p; }) as Check,
  translation: ((r, ctx) => {
    const p = generic(r, ctx);
    if (!String(r.description ?? "").trim() || String(r.description).trim().length < Math.min(80, (ctx.sourceLength ?? 0) / 4)) p.push("translated description is far shorter than the original");
    if (!String(r.role ?? "").trim()) p.push("role is empty");
    return p;
  }) as Check,
  /** Long-form Markdown (resume, cover letter, prep) — very light. */
  markdown: ((r: string, _ctx: { sourceLength?: number }) => {
    const p: string[] = [];
    const words = r.split(/\s+/).filter(Boolean).length;
    if (words < 60) p.push(`only ${words} words`);
    if (/\{\{[A-Z_]+\}\}|lorem ipsum/i.test(r)) p.push("contains template placeholders");
    if (/(\b\S+\b)(?:\s+\1\b){6,}/.test(r)) p.push("repeated tokens");
    return p;
  }) as unknown as Check,
};

// ---------- per-model reliability ----------
interface Stat { ok: number; junk: number; lastJunk?: string; lastProblem?: string }
const KEY = "modelStats";
function readStats(): Record<string, Stat> { const raw = (db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as any)?.value; return raw ? JSON.parse(raw) : {}; }
function writeStats(s: Record<string, Stat>) { db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(s)); }
const routeId = (r: Route) => `${r.provider}/${r.model}`;
export function recordOutcome(r: Route, ok: boolean, problem?: string) {
  const s = readStats(); const st = s[routeId(r)] ?? { ok: 0, junk: 0 };
  if (ok) st.ok++; else { st.junk++; st.lastJunk = new Date().toISOString(); st.lastProblem = problem?.slice(0, 160); }
  s[routeId(r)] = st; writeStats(s);
}
export function modelStats() {
  return Object.entries(readStats()).map(([id, st]) => ({ id, ...st, total: st.ok + st.junk, junkRate: st.ok + st.junk ? Math.round((st.junk / (st.ok + st.junk)) * 100) : 0 }))
    .sort((a, b) => b.junkRate - a.junkRate || b.total - a.total);
}
export function clearModelStats() { writeStats({}); }
/** True when a model has failed often enough to warn about it. */
export function isUnreliable(r: Route) { const st = readStats()[routeId(r)]; return !!st && st.ok + st.junk >= 3 && st.junk / (st.ok + st.junk) >= 0.3; }

// ---------- fallback route ----------
const STRONG = /claude-(?:opus|sonnet|fable)|gpt-5|gpt-4|gemini-2\.5-pro|gemini-3|o[134]-|deepseek-r1|qwen3-235b|llama-3\.1-405b|mistral-large/i;
export function guardSettings(): { enabled: boolean; provider: string | null; model: string | null } {
  const raw = (db.prepare("SELECT value FROM settings WHERE key = 'guard'").get() as any)?.value;
  return { enabled: true, provider: null, model: null, ...(raw ? JSON.parse(raw) : {}) };
}
export function saveGuardSettings(input: { enabled?: unknown; provider?: unknown; model?: unknown }) {
  const cur = guardSettings();
  const next = {
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : cur.enabled,
    provider: input.provider !== undefined ? (PROVIDERS as readonly string[]).includes(String(input.provider)) ? String(input.provider) : null : cur.provider,
    model: input.model !== undefined ? String(input.model ?? "").trim() || null : cur.model,
  };
  db.prepare("INSERT INTO settings (key, value) VALUES ('guard', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  return next;
}
/** Where to retry when `failing` returned junk: the configured fallback, else the strongest model already in use, else Anthropic directly. */
export function resolveFallback(failing: Route): Route | null {
  const g = guardSettings();
  const same = (r: Route) => r.provider === failing.provider && r.model === failing.model;
  if (g.provider && g.model) { const r = { provider: g.provider as Route["provider"], model: g.model }; return same(r) ? null : r; }
  const s = llmSettings();
  const candidates: Route[] = [{ provider: s.provider, model: s.model }, ...Object.values(s.tasks).filter((x): x is Route => !!x)];
  const strong = candidates.find((r) => STRONG.test(r.model) && !same(r) && !isUnreliable(r) && (r.provider === "ollama" || apiKey(r.provider as "anthropic" | "openrouter")));
  if (strong) return strong;
  if (apiKey("anthropic") && !same({ provider: "anthropic", model: "claude-opus-5" })) return { provider: "anthropic", model: "claude-opus-5" };
  return null;
}

// ---------- the guard ----------
/**
 * Run `attempt(route)` on the task's route; if the result fails its check,
 * retry once on the fallback route. Records an ok/junk outcome per model.
 */
export async function guarded<T>(task: Task, check: Check, attempt: (route: Route) => Promise<T>, ctx: { sourceLength?: number } = {}): Promise<T> {
  const first = taskRoute(task);
  const result = await attempt(first);
  const problems = guardSettings().enabled ? check(result, ctx) : [];
  if (!problems.length) { recordOutcome(first, true); return result; }
  recordOutcome(first, false, problems.join("; "));
  const fb = guardSettings().enabled ? resolveFallback(first) : null;
  if (!fb) throw new Error(`${routeId(first)} returned unusable output (${problems[0]}${problems.length > 1 ? ` +${problems.length - 1} more` : ""}). No fallback model is configured — set one in Settings → Quality guard, or route this task to a stronger model.`);
  report(`${first.model} returned junk (${problems[0]}) — retrying with ${fb.model}…`);
  const second = await attempt(fb);
  const again = check(second, ctx);
  if (again.length) { recordOutcome(fb, false, again.join("; ")); throw new Error(`Both ${routeId(first)} and ${routeId(fb)} returned unusable output (${again[0]}).`); }
  recordOutcome(fb, true);
  return second;
}
