/**
 * Job feed: pulls postings from public job-board APIs (company boards on
 * Greenhouse / Lever / Ashby / Workable / SmartRecruiters, plus the Arbeitnow,
 * RemoteOK and Remotive aggregators), filters them by your keywords and
 * locations, and triages each new one with a quick fit score so only the
 * promising ones surface. Nothing here scrapes HTML — every source is an
 * official JSON endpoint.
 */
import { db } from "./db.ts";
import { htmlToText } from "./scrape.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS feed_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    source         TEXT NOT NULL,          -- greenhouse:stripe, arbeitnow, …
    external_id    TEXT NOT NULL,
    company        TEXT NOT NULL,
    title          TEXT NOT NULL,
    location       TEXT,
    remote         INTEGER NOT NULL DEFAULT 0,
    salary         TEXT,
    url            TEXT NOT NULL,
    description    TEXT,
    posted_at      TEXT,
    fit_score      INTEGER,
    fit_reason     TEXT,
    status         TEXT NOT NULL DEFAULT 'new',   -- new | dismissed | tracked
    application_id INTEGER,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source, external_id)
  );
  CREATE INDEX IF NOT EXISTS feed_items_status ON feed_items(status, fit_score);
`);

// ---------- settings ----------

export interface FeedSettings {
  keywords: string[];        // any of these phrases (all words of a phrase) in the title
  locations: string[];       // any of these in the location; "remote" matches remote roles; empty = anywhere
  exclude: string[];         // title or location containing any of these is skipped
  boards: string[];          // "greenhouse:stripe", "lever:spotify", "ashby:ramp", "workable:acme", "smartrecruiters:Acme"
  aggregators: { arbeitnow: boolean; remoteok: boolean; remotive: boolean };
  minScore: number;          // surface as "hot" at or above this
  scorePerRefresh: number;   // cap on model calls per refresh
  autoHours: number;         // 0 = manual only
}
const DEFAULTS: FeedSettings = {
  keywords: [], locations: [], exclude: ["intern", "internship", "staffing agency"], boards: [],
  aggregators: { arbeitnow: true, remoteok: true, remotive: true }, minScore: 3, scorePerRefresh: 20, autoHours: 0,
};
const getSetting = (k: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value;
const setSetting = (k: string, v: string) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

export function feedSettings(): FeedSettings {
  const raw = getSetting("feed");
  return raw ? { ...DEFAULTS, ...JSON.parse(raw), aggregators: { ...DEFAULTS.aggregators, ...(JSON.parse(raw).aggregators ?? {}) } } : DEFAULTS;
}
const list = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(/[\n,]/)).map((x) => String(x).trim()).filter(Boolean);
export function saveFeedSettings(input: Partial<Record<keyof FeedSettings, unknown>>): FeedSettings {
  const cur = feedSettings();
  const num = (v: unknown, d: number, max: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 && n <= max ? n : d; };
  const boards = input.boards !== undefined ? list(input.boards).map((b) => b.toLowerCase().replace(/\s+/g, "")).filter((b) => /^(greenhouse|lever|ashby|workable|smartrecruiters):[\w.-]+$/i.test(b)) : cur.boards;
  const agg = input.aggregators as Partial<FeedSettings["aggregators"]> | undefined;
  const next: FeedSettings = {
    keywords: input.keywords !== undefined ? list(input.keywords) : cur.keywords,
    locations: input.locations !== undefined ? list(input.locations) : cur.locations,
    exclude: input.exclude !== undefined ? list(input.exclude) : cur.exclude,
    boards,
    aggregators: { arbeitnow: agg?.arbeitnow ?? cur.aggregators.arbeitnow, remoteok: agg?.remoteok ?? cur.aggregators.remoteok, remotive: agg?.remotive ?? cur.aggregators.remotive },
    minScore: input.minScore !== undefined ? Math.max(1, Math.min(5, num(input.minScore, cur.minScore, 5))) : cur.minScore,
    scorePerRefresh: input.scorePerRefresh !== undefined ? num(input.scorePerRefresh, cur.scorePerRefresh, 200) : cur.scorePerRefresh,
    autoHours: input.autoHours !== undefined ? num(input.autoHours, cur.autoHours, 168) : cur.autoHours,
  };
  setSetting("feed", JSON.stringify(next));
  return next;
}
export const feedLastRefresh = () => getSetting("feed:lastRefresh") ?? null;
export const markFeedRefreshed = () => setSetting("feed:lastRefresh", new Date().toISOString());

// ---------- sources ----------

export interface Posting {
  source: string; external_id: string; company: string; title: string; location: string;
  remote: boolean; salary: string; url: string; description: string; posted_at: string | null;
}
const UA = "JobTracker/1.0 (personal job-application tracker)";
async function getJson(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", "user-agent": UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const iso = (v: unknown) => { const d = v ? new Date(typeof v === "number" && v < 1e12 ? v * 1000 : (v as any)) : null; return d && !isNaN(+d) ? d.toISOString().slice(0, 10) : null; };
const text = (html: unknown) => htmlToText(String(html ?? "")).slice(0, 20_000);

/** Company boards: "provider:token". */
export async function fetchBoard(board: string): Promise<Posting[]> {
  const [provider, token] = board.split(":");
  switch (provider) {
    case "greenhouse": {
      const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
      return (d.jobs ?? []).map((j: any) => ({ source: board, external_id: String(j.id), company: j.company_name || token, title: j.title, location: j.location?.name ?? "", remote: /remote/i.test(j.location?.name ?? ""), salary: "", url: j.absolute_url, description: text(j.content), posted_at: iso(j.first_published || j.updated_at) }));
    }
    case "lever": {
      const d = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
      return (Array.isArray(d) ? d : []).map((j: any) => ({ source: board, external_id: String(j.id), company: token, title: j.text, location: (j.categories?.allLocations ?? [j.categories?.location]).filter(Boolean).join(" / "), remote: j.workplaceType === "remote" || /remote/i.test(j.categories?.location ?? ""), salary: "", url: j.hostedUrl, description: [j.descriptionPlain, ...(j.lists ?? []).map((l: any) => `${l.text}\n${text(l.content)}`), j.additionalPlain].filter(Boolean).join("\n\n").slice(0, 20_000), posted_at: iso(j.createdAt) }));
    }
    case "ashby": {
      const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`);
      return (d.jobs ?? []).filter((j: any) => j.isListed !== false).map((j: any) => ({ source: board, external_id: String(j.id), company: token, title: j.title, location: [j.location, ...(j.secondaryLocations ?? []).map((l: any) => l.location)].filter(Boolean).join(" / "), remote: Boolean(j.isRemote) || j.workplaceType === "Remote", salary: j.compensation?.compensationTierSummary ?? "", url: j.jobUrl, description: (j.descriptionPlain || text(j.descriptionHtml)).slice(0, 20_000), posted_at: iso(j.publishedAt) }));
    }
    case "workable": {
      const d = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${token}?details=true`);
      return (d.jobs ?? []).map((j: any) => ({ source: board, external_id: String(j.shortcode ?? j.code ?? j.url), company: d.name || token, title: j.title, location: [j.city, j.state, j.country].filter(Boolean).join(", "), remote: Boolean(j.telecommuting), salary: "", url: j.url ?? j.application_url, description: text(j.description) + (j.requirements ? `\n\nRequirements\n${text(j.requirements)}` : ""), posted_at: iso(j.published_on) }));
    }
    case "smartrecruiters": {
      const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`);
      return (d.content ?? []).map((j: any) => ({ source: board, external_id: String(j.id), company: j.company?.name || token, title: j.name, location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", "), remote: Boolean(j.location?.remote), salary: "", url: `https://jobs.smartrecruiters.com/${token}/${j.id}`, description: "", posted_at: iso(j.releasedDate) }));
    }
    default: throw new Error(`Unknown board provider "${provider}"`);
  }
}

/** Aggregators — keyword-driven, many companies. */
export async function fetchAggregator(name: string, keywords: string[]): Promise<Posting[]> {
  if (name === "arbeitnow") {
    const out: Posting[] = [];
    for (let page = 1; page <= 4; page++) { // ~250 per page, newest first
      const d = await getJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
      for (const j of d.data ?? []) out.push({ source: "arbeitnow", external_id: j.slug, company: j.company_name, title: j.title, location: j.location ?? "", remote: Boolean(j.remote), salary: "", url: j.url, description: text(j.description), posted_at: iso(j.created_at) });
      if (!d.links?.next) break;
    }
    return out;
  }
  if (name === "remoteok") {
    const d = await getJson("https://remoteok.com/api", { headers: { "user-agent": "Mozilla/5.0" } });
    return (Array.isArray(d) ? d : []).filter((j: any) => j.position).map((j: any) => ({ source: "remoteok", external_id: String(j.id), company: j.company, title: j.position, location: j.location || "Remote", remote: true, salary: j.salary_min ? `$${j.salary_min}–$${j.salary_max}` : "", url: j.url, description: text(j.description), posted_at: iso(j.date) }));
  }
  if (name === "remotive") {
    const out: Posting[] = [];
    for (const kw of keywords.length ? keywords : [""]) {
      const d = await getJson(`https://remotive.com/api/remote-jobs?limit=100${kw ? `&search=${encodeURIComponent(kw)}` : ""}`, { headers: { "user-agent": "Mozilla/5.0" } });
      for (const j of d.jobs ?? []) out.push({ source: "remotive", external_id: String(j.id), company: j.company_name, title: j.title, location: j.candidate_required_location || "Remote", remote: true, salary: j.salary ?? "", url: j.url, description: text(j.description), posted_at: iso(j.publication_date) });
    }
    return out;
  }
  throw new Error(`Unknown aggregator "${name}"`);
}

// ---------- filtering ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#. ]+/g, " ");
/** Every word of at least one keyword phrase appears in the title. */
export function matchesKeywords(title: string, keywords: string[]) {
  if (!keywords.length) return true;
  const t = ` ${norm(title)} `;
  return keywords.some((k) => norm(k).split(/\s+/).filter(Boolean).every((w) => t.includes(w)));
}
export function matchesLocation(p: Posting, locations: string[]) {
  if (!locations.length) return true;
  const loc = norm(p.location);
  return locations.some((l) => { const n = norm(l).trim(); return (n === "remote" && p.remote) || loc.includes(n); });
}
export function isExcluded(p: Posting, exclude: string[]) {
  const hay = norm(`${p.title} ${p.location}`);
  return exclude.some((x) => hay.includes(norm(x).trim()));
}

// ---------- store ----------

export function insertNew(postings: Posting[]): number {
  const ins = db.prepare(`INSERT OR IGNORE INTO feed_items (source, external_id, company, title, location, remote, salary, url, description, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const knownUrl = db.prepare("SELECT 1 FROM feed_items WHERE url = ? UNION SELECT 1 FROM applications WHERE url = ?");
  let n = 0;
  for (const p of postings) {
    if (knownUrl.get(p.url, p.url)) continue; // same posting via another source, or already tracked
    n += Number(ins.run(p.source, p.external_id, p.company, p.title, p.location, p.remote ? 1 : 0, p.salary, p.url, p.description, p.posted_at).changes);
  }
  return n;
}

export function listFeed(status: string | null = null) {
  const where = status ? "WHERE status = ?" : "WHERE status != 'dismissed'";
  return db.prepare(`SELECT id, source, company, title, location, remote, salary, url, posted_at, fit_score, fit_reason, status, application_id, created_at, length(description) AS desc_len FROM feed_items ${where} ORDER BY (fit_score IS NULL), fit_score DESC, posted_at DESC, id DESC LIMIT 500`).all(...(status ? [status] : []));
}
export const getFeedItem = (id: number) => db.prepare("SELECT * FROM feed_items WHERE id = ?").get(id) as any;
export const unscoredIds = (limit: number) => (db.prepare("SELECT id FROM feed_items WHERE fit_score IS NULL AND status = 'new' ORDER BY posted_at DESC, id DESC LIMIT ?").all(limit) as { id: number }[]).map((r) => r.id);
export function feedCounts() {
  const s = feedSettings();
  const r = db.prepare("SELECT SUM(status='new' AND fit_score >= ?) AS hot, SUM(status='new' AND fit_score IS NULL) AS unscored, SUM(status='new') AS open FROM feed_items").get(s.minScore) as any;
  return { hot: r.hot ?? 0, unscored: r.unscored ?? 0, open: r.open ?? 0 };
}
