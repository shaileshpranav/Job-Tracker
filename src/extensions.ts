/**
 * Extensions: user-installed connectors for job boards the bundled sources don't cover.
 *
 * The sources that ship with the app are deliberately limited to official JSON endpoints
 * (see feed.ts). Extensions are the escape hatch for everything else — a board with only an
 * internal API, a site that needs HTML parsing, a private/company-specific board. They are
 * *your* code, loaded from `extensions/` and run in the server process with the same access
 * the app itself has, so only install ones you have read.
 *
 * An extension is a .ts/.js file whose default export is an `Extension`. See
 * `extensions/README.md` for the full contract and a worked example.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./db.ts";
import { htmlToText, jobPostingFromJsonLd } from "./scrape.ts";

export const EXT_DIR = process.env.EXTENSIONS_DIR ? path.resolve(process.env.EXTENSIONS_DIR) : path.join(ROOT, "extensions");

/** What an extension gets handed: fetch helpers, parsing helpers, and the user's feed settings. */
export interface ExtensionContext {
  /** GET and parse JSON. Throws on a non-2xx status. */
  fetchJson(url: string, init?: RequestInit): Promise<any>;
  /** GET and return the body as text. Throws on a non-2xx status. */
  fetchText(url: string, init?: RequestInit): Promise<string>;
  /** POST a JSON body and parse the JSON response (internal APIs usually want this). */
  postJson(url: string, body: unknown, init?: RequestInit): Promise<any>;
  /** Crude HTML → text, same one the core capture path uses. */
  htmlToText(html: string): string;
  /** Pull a schema.org JobPosting out of a page's JSON-LD, or "" if there isn't one. */
  jobPostingFromJsonLd(html: string): string;
  /** Shows up in the task's progress line and the server log. */
  progress(msg: string): void;
  /** The user's feed settings, for extensions that search rather than list. */
  keywords: string[];
  locations: string[];
}

/** Loose posting shape — normalised into the feed's own shape by `toPosting`. */
export interface ExtPosting {
  id?: string | number;
  title: string;
  company?: string;
  location?: string;
  remote?: boolean;
  salary?: string;
  url: string;
  description?: string;
  posted_at?: string | number | Date | null;
}

export interface Extension {
  /** Lowercase id, unique. Board extensions use it as the provider: `<id>:<token>`. */
  id: string;
  label: string;
  /** "board" = one instance per company (configured as `<id>:<token>`); "aggregator" = one global source. */
  kind?: "board" | "aggregator";
  /** Board extensions only: turn a careers URL into a token so "Find board" can resolve it. */
  match?(url: string): string | null;
  /** Fetch postings. `token` is the board token, or "" for an aggregator. */
  fetch?(token: string, ctx: ExtensionContext): Promise<ExtPosting[]>;
  /** Take over single-posting capture for URLs this extension recognises. */
  capture?: {
    matches(url: string): boolean;
    /** Page text for the extractor, or null to fall through to the normal capture path. */
    fetch(url: string, ctx: ExtensionContext): Promise<string | null>;
  };
}

export interface LoadedExtension extends Extension { file: string }

const loaded: LoadedExtension[] = [];
const failures: { file: string; error: string }[] = [];

// ---------- the context handed to extensions ----------

const UA = "JobTracker/1.0 (personal job-application tracker)";
async function req(url: string, init: RequestInit = {}, accept = "application/json"): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { accept, "user-agent": UA, ...(init.headers ?? {}) }, signal: init.signal ?? AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res;
}
export function extensionContext(progress: (msg: string) => void, feed: { keywords: string[]; locations: string[] }): ExtensionContext {
  return {
    fetchJson: async (url, init) => (await req(url, init)).json(),
    fetchText: async (url, init) => (await req(url, init, "text/html,*/*")).text(),
    postJson: async (url, body, init = {}) => (await req(url, { ...init, method: "POST", headers: { "content-type": "application/json", ...(init.headers ?? {}) }, body: JSON.stringify(body) })).json(),
    htmlToText, jobPostingFromJsonLd, progress,
    keywords: feed.keywords, locations: feed.locations,
  };
}

// ---------- loading ----------

const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;

function validate(mod: any, file: string): Extension {
  const e = mod?.default ?? mod;
  if (!e || typeof e !== "object") throw new Error("no default export (expected an extension object)");
  if (typeof e.id !== "string" || !ID_RE.test(e.id)) throw new Error(`invalid id ${JSON.stringify(e.id)} — use lowercase letters, digits and dashes`);
  if (typeof e.label !== "string" || !e.label.trim()) throw new Error("missing label");
  if (e.kind && e.kind !== "board" && e.kind !== "aggregator") throw new Error(`invalid kind ${JSON.stringify(e.kind)} — "board" or "aggregator"`);
  if (e.kind && typeof e.fetch !== "function") throw new Error(`kind "${e.kind}" needs a fetch(token, ctx) function`);
  if (e.capture && (typeof e.capture.matches !== "function" || typeof e.capture.fetch !== "function")) throw new Error("capture needs matches(url) and fetch(url, ctx)");
  if (!e.kind && !e.capture) throw new Error("does nothing — give it a kind (with fetch) or a capture handler");
  return { ...e, file: path.basename(file) } as LoadedExtension;
}

/** Load every extension file. Called once at startup; a broken file is reported, never fatal. */
async function load() {
  loaded.length = 0; failures.length = 0;
  let files: string[] = [];
  try { files = fs.readdirSync(EXT_DIR); } catch { return; } // no extensions/ directory at all
  for (const f of files.sort()) {
    if (!/\.(ts|js|mjs)$/.test(f) || f.startsWith("_") || f.startsWith(".")) continue;
    const full = path.join(EXT_DIR, f);
    try {
      const mod = await import(`${new URL(`file://${full}`).href}?v=${fs.statSync(full).mtimeMs}`);
      const ext = validate(mod, full) as LoadedExtension;
      if (loaded.some((x) => x.id === ext.id)) throw new Error(`duplicate id "${ext.id}" (already loaded from ${loaded.find((x) => x.id === ext.id)!.file})`);
      loaded.push(ext);
    } catch (e: any) {
      failures.push({ file: f, error: e?.message ?? String(e) });
      console.error(`[extension] ${f}: ${e?.message ?? e}`);
    }
  }
  if (loaded.length) console.log(`Extensions loaded: ${loaded.map((e) => e.id).join(", ")}`);
}
await load(); // top-level: anything importing this module gets a populated registry

// ---------- registry ----------

export const extensions = () => loaded as readonly LoadedExtension[];
export const extensionErrors = () => failures as readonly { file: string; error: string }[];
export const getExtension = (id: string) => loaded.find((e) => e.id === id.toLowerCase()) ?? null;
/** Ids usable as a board provider — for the `provider:token` validation in feed/server. */
export const boardExtensionIds = () => loaded.filter((e) => e.kind === "board").map((e) => e.id);
/** Aggregator-style extensions, as id → label, to merge into the feed's source list. */
export const aggregatorExtensions = (): Record<string, string> => Object.fromEntries(loaded.filter((e) => e.kind === "aggregator").map((e) => [e.id, `${e.label} (extension)`]));

/** A careers URL an extension recognises → its board id, or null. */
export function matchExtensionBoard(url: string): string | null {
  for (const e of loaded) {
    if (e.kind !== "board" || typeof e.match !== "function") continue;
    try { const token = e.match(url); if (token) return `${e.id}:${token}`; } catch { /* a bad matcher shouldn't break discovery */ }
  }
  return null;
}

const FETCH_TIMEOUT_MS = 120_000;
const MAX_POSTINGS = 2000;

/** Run an extension's fetch and normalise what it returns into feed postings. */
export async function fetchExtension(id: string, token: string, ctx: ExtensionContext): Promise<any[]> {
  const ext = getExtension(id);
  if (!ext?.fetch) throw new Error(`No extension "${id}" with a fetch handler is loaded`);
  const source = ext.kind === "board" ? `${ext.id}:${token}` : ext.id;
  const out = await Promise.race([
    ext.fetch(token, ctx),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`extension "${id}" took longer than ${FETCH_TIMEOUT_MS / 1000}s`)), FETCH_TIMEOUT_MS).unref?.()),
  ]);
  if (!Array.isArray(out)) throw new Error(`extension "${id}" returned ${typeof out}, expected an array of postings`);
  return out.slice(0, MAX_POSTINGS).map((p) => toPosting(p, source, ext)).filter((p): p is NonNullable<typeof p> => p !== null);
}

/** Extension posting → the feed's row shape. Anything without a url and title is dropped. */
function toPosting(p: ExtPosting, source: string, ext: Extension) {
  const url = String(p?.url ?? "").trim(), title = String(p?.title ?? "").trim();
  if (!/^https?:\/\//i.test(url) || !title) return null;
  const d = p.posted_at ? new Date(typeof p.posted_at === "number" && p.posted_at < 1e12 ? p.posted_at * 1000 : (p.posted_at as any)) : null;
  return {
    source, external_id: String(p.id ?? url), company: String(p.company ?? ext.label).trim().slice(0, 200) || ext.label,
    title: title.slice(0, 300), location: String(p.location ?? "").slice(0, 300), remote: Boolean(p.remote),
    salary: String(p.salary ?? "").slice(0, 120), url, description: String(p.description ?? "").slice(0, 20_000),
    posted_at: d && !isNaN(+d) ? d.toISOString().slice(0, 10) : null,
  };
}

/** Let an extension handle a posting URL. Returns page text, or null if none claims it. */
export async function captureViaExtension(url: string, ctx: ExtensionContext): Promise<{ text: string; id: string } | null> {
  for (const e of loaded) {
    if (!e.capture) continue;
    let claims = false;
    try { claims = Boolean(e.capture.matches(url)); } catch { continue; }
    if (!claims) continue;
    try {
      const text = await e.capture.fetch(url, ctx);
      if (text && text.trim().length >= 200) return { text: text.trim(), id: e.id };
    } catch (err: any) {
      console.error(`[extension ${e.id}] capture failed: ${err?.message ?? err}`);
    }
  }
  return null;
}
