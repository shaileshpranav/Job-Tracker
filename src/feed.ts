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
const fcols = new Set((db.prepare("PRAGMA table_info(feed_items)").all() as { name: string }[]).map((c) => c.name));
if (!fcols.has("ats_pct")) db.exec("ALTER TABLE feed_items ADD COLUMN ats_pct INTEGER; ALTER TABLE feed_items ADD COLUMN ats_missing TEXT; ALTER TABLE feed_items ADD COLUMN seen INTEGER NOT NULL DEFAULT 0; ALTER TABLE feed_items ADD COLUMN dedupe_key TEXT");
if (!fcols.has("level")) db.exec("ALTER TABLE feed_items ADD COLUMN level TEXT; ALTER TABLE feed_items ADD COLUMN lang TEXT; ALTER TABLE feed_items ADD COLUMN title_en TEXT");
db.exec("CREATE INDEX IF NOT EXISTS feed_items_dedupe ON feed_items(dedupe_key)");
// Tracked items whose application was deleted should be trackable again, not dead links.
db.prepare("UPDATE feed_items SET status = 'new', application_id = NULL WHERE status = 'tracked' AND (application_id IS NULL OR application_id NOT IN (SELECT id FROM applications))").run();

// ---------- settings ----------

export const AGGREGATORS = {
  arbeitnow: "Arbeitnow (Europe)", remoteok: "RemoteOK", remotive: "Remotive", hn: "HN “Who is hiring”", muse: "The Muse", himalayas: "Himalayas (remote)", jobicy: "Jobicy (remote)", adzuna: "Adzuna (needs a free key)",
} as const;
export type Aggregator = keyof typeof AGGREGATORS;
export interface FeedSettings {
  keywords: string[];        // any of these phrases (all words of a phrase) in the title (or description, see matchIn)
  matchIn: "title" | "text"; // where keywords must appear
  locations: string[];       // any of these in the location; "remote" matches remote roles; empty = anywhere
  exclude: string[];         // title or location containing any of these is skipped
  boards: string[];          // "greenhouse:stripe", "lever:spotify", "ashby:ramp", "workable:acme", "smartrecruiters:Acme"
  aggregators: Record<Aggregator, boolean>;
  adzuna: { appId: string; appKey: string };
  levels: Level[];           // career levels to keep (empty = all)
  autoTranslate: boolean;    // translate non-English titles for matching (and captured postings)
  minScore: number;          // surface as "hot" at or above this
  minAts: number;            // skip model scoring when keyword coverage against every base is below this (%)
  scorePerRefresh: number;   // cap on model calls per refresh
  maxAgeDays: number;        // ignore postings older than this
  autoHours: number;         // 0 = manual only
}
const DEFAULTS: FeedSettings = {
  keywords: [], matchIn: "title", locations: [], exclude: ["intern", "internship", "staffing agency"], boards: [],
  aggregators: { arbeitnow: true, remoteok: true, remotive: true, hn: true, muse: false, himalayas: true, jobicy: false, adzuna: false },
  adzuna: { appId: "", appKey: "" }, levels: ["junior", "mid", "senior", "staff", "principal", "lead"], autoTranslate: true,
  minScore: 3, minAts: 15, scorePerRefresh: 20, maxAgeDays: 30, autoHours: 0,
};

// ---------- career level (from the title, deterministic) ----------
export const LEVELS = ["intern", "junior", "mid", "senior", "staff", "principal", "lead", "manager"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABELS: Record<Level, string> = { intern: "Intern", junior: "Junior / entry", mid: "Mid-level", senior: "Senior", staff: "Staff", principal: "Principal / distinguished", lead: "Lead / head of", manager: "Manager / director / VP" };
export function classifyLevel(title: string): Level {
  const t = ` ${title.toLowerCase().replace(/[()\[\],/|–—-]+/g, " ")} `;
  if (/\b(intern|internship|praktikant\w*|werkstudent\w*|trainee|apprentice)\b/.test(t)) return "intern";
  if (/\b(principal|distinguished|fellow|architect)\b/.test(t)) return "principal";
  if (/\bstaff\b/.test(t)) return "staff";
  if (/\b(manager|director|vp|vice president|chief|cto|ceo|coo|head)\b/.test(t) && !/\bhead\s?of\b/.test(t)) return "manager";
  if (/\b(lead|leader|head of|tech lead|team lead)\b/.test(t)) return "lead";
  if (/\b(senior|sr|iii|iv|expert|experienced)\b/.test(t)) return "senior";
  if (/\b(junior|jr|entry level|entry|graduate|grad|associate|new grad|early career|i)\b/.test(t)) return "junior";
  return "mid";
}
export const matchesLevel = (level: Level, levels: Level[]) => !levels.length || levels.includes(level);

// ---------- language (cheap heuristic, good enough to decide whether to translate) ----------
const LANG_HINTS: [string, RegExp][] = [
  ["de", /\b(und|oder|nicht|mit|für|wir|sie|eine|einen|einem|das|die|der|ist|sind|werden|bei|auch|kenntnisse|erfahrung|entwickler|ingenieur|stellenangebot|bewerbung|aufgaben|anforderungen)\b/gi],
  ["fr", /\b(et|ou|pas|avec|pour|nous|vous|une|des|les|est|sont|être|chez|aussi|compétences|expérience|développeur|ingénieur|poste|candidature|missions)\b/gi],
  ["es", /\b(y|o|no|con|para|nosotros|una|los|las|es|son|ser|también|habilidades|experiencia|desarrollador|ingeniero|puesto|funciones|requisitos)\b/gi],
  ["it", /\b(e|o|non|con|per|noi|una|gli|le|è|sono|essere|anche|competenze|esperienza|sviluppatore|ingegnere|posizione|candidatura|requisiti)\b/gi],
  ["nl", /\b(en|of|niet|met|voor|wij|een|het|de|is|zijn|worden|ook|vaardigheden|ervaring|ontwikkelaar|functie|sollicitatie|werkzaamheden)\b/gi],
  ["da", /\b(og|eller|ikke|med|til|vi|en|et|det|er|være|også|kompetencer|erfaring|udvikler|stilling|ansøgning|arbejdsopgaver|kvalifikationer)\b/gi],
  ["sv", /\b(och|eller|inte|med|för|vi|en|ett|det|är|vara|också|kompetens|erfarenhet|utvecklare|tjänst|ansökan|arbetsuppgifter|kvalifikationer)\b/gi],
  ["pt", /\b(e|ou|não|com|para|nós|uma|os|as|é|são|ser|também|habilidades|experiência|desenvolvedor|engenheiro|vaga|candidatura|requisitos)\b/gi],
  ["pl", /\b(i|lub|nie|z|dla|my|jest|są|być|także|umiejętności|doświadczenie|programista|inżynier|stanowisko|aplikacja|obowiązki|wymagania)\b/gi],
];
const EN = /\b(the|and|with|for|you|will|our|are|is|to|of|in|experience|team|role|skills|requirements|we|engineer|developer)\b/gi;
export function detectLang(text: string): string {
  const t = text.slice(0, 3000);
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(t)) return "ja";
  if (/[\uac00-\ud7af]/.test(t)) return "ko";
  if (/[\u0400-\u04ff]/.test(t)) return "ru";
  if (/[\u0600-\u06ff]/.test(t)) return "ar";
  if (/[\u0e00-\u0e7f]/.test(t)) return "th";
  const en = (t.match(EN) ?? []).length;
  let best = "en", bestN = en;
  for (const [code, re] of LANG_HINTS) { const n = (t.match(re) ?? []).length; if (n > bestN * 1.15 && n >= 6) { best = code; bestN = n; } }
  return best;
}
const getSetting = (k: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value;
const setSetting = (k: string, v: string) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

export function feedSettings(): FeedSettings {
  const raw = getSetting("feed");
  if (!raw) return DEFAULTS;
  const j = JSON.parse(raw);
  return { ...DEFAULTS, ...j, aggregators: { ...DEFAULTS.aggregators, ...(j.aggregators ?? {}) }, adzuna: { ...DEFAULTS.adzuna, ...(j.adzuna ?? {}) } };
}
const list = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(/[\n,]/)).map((x) => String(x).trim()).filter(Boolean);
export function saveFeedSettings(input: Partial<Record<keyof FeedSettings, unknown>>): FeedSettings {
  const cur = feedSettings();
  const num = (v: unknown, d: number, max: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 && n <= max ? n : d; };
  const boards = input.boards !== undefined ? list(input.boards).map((b) => b.toLowerCase().replace(/\s+/g, "")).filter((b) => /^(greenhouse|lever|ashby|workable|smartrecruiters):[\w.-]+$/i.test(b)) : cur.boards;
  const agg = (input.aggregators ?? {}) as Partial<Record<Aggregator, boolean>>;
  const adz = (input.adzuna ?? {}) as Partial<FeedSettings["adzuna"]>;
  const next: FeedSettings = {
    keywords: input.keywords !== undefined ? list(input.keywords) : cur.keywords,
    matchIn: input.matchIn === "text" ? "text" : input.matchIn === "title" ? "title" : cur.matchIn,
    locations: input.locations !== undefined ? list(input.locations) : cur.locations,
    exclude: input.exclude !== undefined ? list(input.exclude) : cur.exclude,
    boards,
    aggregators: Object.fromEntries((Object.keys(AGGREGATORS) as Aggregator[]).map((k) => [k, agg[k] !== undefined ? Boolean(agg[k]) : cur.aggregators[k]])) as Record<Aggregator, boolean>,
    adzuna: { appId: adz.appId !== undefined ? String(adz.appId).trim() : cur.adzuna.appId, appKey: adz.appKey !== undefined ? String(adz.appKey).trim() : cur.adzuna.appKey },
    levels: input.levels !== undefined ? (Array.isArray(input.levels) ? input.levels : list(input.levels)).map(String).filter((l): l is Level => (LEVELS as readonly string[]).includes(l)) : cur.levels,
    autoTranslate: input.autoTranslate !== undefined ? Boolean(input.autoTranslate) : cur.autoTranslate,
    minScore: input.minScore !== undefined ? Math.max(1, Math.min(5, num(input.minScore, cur.minScore, 5))) : cur.minScore,
    minAts: input.minAts !== undefined ? num(input.minAts, cur.minAts, 100) : cur.minAts,
    scorePerRefresh: input.scorePerRefresh !== undefined ? num(input.scorePerRefresh, cur.scorePerRefresh, 200) : cur.scorePerRefresh,
    maxAgeDays: input.maxAgeDays !== undefined ? num(input.maxAgeDays, cur.maxAgeDays, 365) : cur.maxAgeDays,
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
  level?: Level; lang?: string; title_en?: string | null;
}
const UA = "JobTracker/1.0 (personal job-application tracker)";
async function getJson(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", "user-agent": UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const iso = (v: unknown) => { const d = v ? new Date(typeof v === "number" && v < 1e12 ? v * 1000 : (v as any)) : null; return d && !isNaN(+d) ? d.toISOString().slice(0, 10) : null; };
const text = (html: unknown) => htmlToText(String(html ?? "")).slice(0, 20_000);

/**
 * Work out a board id from any careers URL (or a company homepage, by looking
 * for an embedded board link). Returns null when nothing recognisable is found.
 */
export async function discoverBoard(input: string): Promise<{ board: string; via: string } | null> {
  const fromUrl = (u: string): string | null => {
    const m = [
      [/boards\.greenhouse\.io\/([\w-]+)/i, "greenhouse"], [/job-boards\.greenhouse\.io\/([\w-]+)/i, "greenhouse"], [/boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/i, "greenhouse"], [/greenhouse\.io\/embed\/job_board\?for=([\w-]+)/i, "greenhouse"],
      [/jobs\.lever\.co\/([\w-]+)/i, "lever"], [/api\.lever\.co\/v0\/postings\/([\w-]+)/i, "lever"],
      [/jobs\.ashbyhq\.com\/([\w-]+)/i, "ashby"], [/api\.ashbyhq\.com\/posting-api\/job-board\/([\w-]+)/i, "ashby"],
      [/apply\.workable\.com\/(?:api\/v\d\/widget\/accounts\/)?([\w-]+)/i, "workable"], [/([\w-]+)\.workable\.com/i, "workable"],
      [/jobs\.smartrecruiters\.com\/([\w-]+)/i, "smartrecruiters"], [/careers\.smartrecruiters\.com\/([\w-]+)/i, "smartrecruiters"],
    ] as const;
    for (const [re, provider] of m) { const x = re.exec(u); if (x && !["www", "api", "jobs", "careers"].includes(x[1].toLowerCase())) return `${provider}:${x[1]}`; }
    return null;
  };
  const text = input.trim();
  if (/^(greenhouse|lever|ashby|workable|smartrecruiters):/i.test(text)) return { board: text.toLowerCase(), via: "id" };
  const direct = fromUrl(text);
  if (direct) return { board: direct, via: "url" };
  if (!/^https?:\/\//i.test(text) && !/\./.test(text)) return null;
  // Fetch the page (and /careers, /jobs if it's a homepage) and look for a board link or API call.
  const urls = [text.startsWith("http") ? text : `https://${text}`];
  try { const u = new URL(urls[0]); if (u.pathname === "/" || u.pathname === "") urls.push(`${u.origin}/careers`, `${u.origin}/jobs`, `${u.origin}/careers/`); } catch { return null; }
  let mentioned: string[] = [];
  for (const u of urls) {
    try {
      const res = await fetch(u, { headers: { "user-agent": "Mozilla/5.0", accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
      if (!res.ok) continue;
      const html = await res.text();
      const found = fromUrl(res.url) ?? fromUrl(html);
      if (found) return { board: found, via: u };
      for (const p of ["greenhouse", "lever", "ashby", "workable", "smartrecruiters"]) if (new RegExp(p, "i").test(html) && !mentioned.includes(p)) mentioned.push(p);
    } catch { /* try the next */ }
  }
  // Last resort: JS-rendered careers pages hide the board. Try the company's domain name as the
  // token — providers the page mentions first, then the rest — and keep whichever answers.
  const host = (() => { try { return new URL(urls[0]).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const label = host.split(".").slice(0, -1).pop() ?? "";
  if (!label || label.length < 3) return null;
  const order = [...mentioned, ...["greenhouse", "lever", "ashby", "workable", "smartrecruiters"].filter((p) => !mentioned.includes(p))];
  for (const p of order) {
    try { const jobs = await fetchBoard(`${p}:${label}`); if (jobs.length) return { board: `${p}:${label}`, via: `guessed from ${host}` }; } catch { /* not this one */ }
  }
  return null;
}

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
export async function fetchAggregator(name: string, keywords: string[], opts: { locations: string[]; adzuna: FeedSettings["adzuna"] } = { locations: [], adzuna: { appId: "", appKey: "" } }): Promise<Posting[]> {
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
  if (name === "hn") {
    // Latest monthly "Ask HN: Who is hiring?" thread; each top-level comment is one posting.
    const search = await getJson("https://hn.algolia.com/api/v1/search_by_date?tags=ask_hn,author_whoishiring&query=%22who%20is%20hiring%22&hitsPerPage=5");
    const thread = (search.hits ?? []).find((h: any) => /who is hiring/i.test(h.title));
    if (!thread) return [];
    const item = await getJson(`https://hn.algolia.com/api/v1/items/${thread.objectID}`);
    const month = (thread.title.match(/\((.+?)\)/)?.[1] ?? "").trim();
    return (item.children ?? []).filter((c: any) => c.text).map((c: any) => {
      const plain = htmlToText(c.text);
      const head = plain.split("\n")[0] ?? "";
      const parts = head.split("|").map((x: string) => x.trim()).filter(Boolean);
      const company = parts[0] ?? "HN poster", title = parts[1] ?? head.slice(0, 80);
      const location = parts.slice(2).find((p: string) => /remote|onsite|on-site|hybrid|[A-Z][a-z]+,?\s?[A-Z]{2}\b|berlin|london|singapore|new york|san francisco|europe|us\b|usa\b|uk\b/i.test(p)) ?? parts[2] ?? "";
      const salary = parts.find((p: string) => /[$€£]\s?\d|\d+k\b/i.test(p)) ?? "";
      return { source: "hn", external_id: String(c.id), company: company.slice(0, 80), title: title.slice(0, 120), location, remote: /remote/i.test(head), salary, url: `https://news.ycombinator.com/item?id=${c.id}`, description: `${month ? `From HN "Who is hiring" (${month}).\n\n` : ""}${plain}`.slice(0, 20_000), posted_at: iso(c.created_at) };
    });
  }
  if (name === "muse") {
    // No keyword search; pull a few pages per location (their location strings, e.g. "Singapore", "Berlin, Germany", "Flexible / Remote") and filter locally.
    const out: Posting[] = [];
    const locs = opts.locations.length ? opts.locations.map((l) => (/remote/i.test(l) ? "Flexible / Remote" : l)) : [""];
    for (const loc of locs) for (let page = 1; page <= 3; page++) {
      const d = await getJson(`https://www.themuse.com/api/public/jobs?page=${page}${loc ? `&location=${encodeURIComponent(loc)}` : ""}`).catch(() => null);
      if (!d?.results?.length) break;
      for (const j of d.results) out.push({ source: "muse", external_id: String(j.id), company: j.company?.name ?? "", title: j.name, location: (j.locations ?? []).map((l: any) => l.name).join(" / "), remote: (j.locations ?? []).some((l: any) => /remote/i.test(l.name)), salary: "", url: j.refs?.landing_page ?? "", description: text(j.contents), posted_at: iso(j.publication_date) });
      if (page >= (d.page_count ?? 1)) break;
    }
    return out;
  }
  if (name === "himalayas") {
    const out: Posting[] = [];
    for (const kw of keywords.length ? keywords : [""]) {
      const d = await getJson(`https://himalayas.app/jobs/api?limit=100${kw ? `&search=${encodeURIComponent(kw)}` : ""}`);
      for (const j of d.jobs ?? []) out.push({ source: "himalayas", external_id: String(j.guid ?? j.applicationLink), company: j.companyName, title: j.title, location: (j.locationRestrictions ?? []).join(" / ") || "Remote", remote: true, salary: j.minSalary ? `${j.currency ?? ""} ${j.minSalary}–${j.maxSalary}`.trim() : "", url: j.applicationLink ?? j.guid, description: text(j.description || j.excerpt), posted_at: iso(j.pubDate) });
    }
    return out;
  }
  if (name === "jobicy") {
    const out: Posting[] = [];
    for (const kw of keywords.filter((k) => k.length >= 3).length ? keywords.filter((k) => k.length >= 3) : [""]) {
      const d = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=50${kw ? `&tag=${encodeURIComponent(kw.toLowerCase().replace(/\s+/g, "-"))}` : ""}`, { headers: { "user-agent": "Mozilla/5.0" } }).catch(() => null);
      for (const j of d?.jobs ?? []) out.push({ source: "jobicy", external_id: String(j.id), company: j.companyName, title: j.jobTitle, location: j.jobGeo || "Remote", remote: true, salary: j.annualSalaryMin ? `${j.salaryCurrency ?? ""} ${j.annualSalaryMin}–${j.annualSalaryMax}`.trim() : "", url: j.url, description: text(j.jobDescription || j.jobExcerpt), posted_at: iso(j.pubDate) });
    }
    return out;
  }
  if (name === "adzuna") {
    const { appId, appKey } = opts.adzuna;
    if (!appId || !appKey) throw new Error("Adzuna needs an app id and key (free at developer.adzuna.com) — add them in the feed settings");
    // Adzuna is per-country; derive countries from your locations.
    const COUNTRY: [RegExp, string][] = [[/singapore/i, "sg"], [/germany|berlin|munich|hamburg|frankfurt/i, "de"], [/uk|united kingdom|london|england/i, "gb"], [/usa|united states|\bus\b|new york|san francisco|seattle|austin/i, "us"], [/netherlands|amsterdam/i, "nl"], [/france|paris/i, "fr"], [/austria|vienna/i, "at"], [/australia|sydney|melbourne/i, "au"], [/canada|toronto|vancouver/i, "ca"], [/india|bangalore|bengaluru|mumbai|hyderabad/i, "in"], [/poland|warsaw/i, "pl"], [/italy|milan/i, "it"], [/spain|madrid|barcelona/i, "es"], [/brazil/i, "br"], [/mexico/i, "mx"], [/south africa/i, "za"], [/new zealand/i, "nz"]];
    const countries = [...new Set(opts.locations.flatMap((l) => COUNTRY.filter(([re]) => re.test(l)).map(([, c]) => c)))];
    if (!countries.length) throw new Error("Adzuna: none of your locations map to an Adzuna country (sg, de, gb, us, nl, fr, at, au, ca, in, pl, it, es, br, mx, za, nz)");
    const out: Posting[] = [];
    for (const c of countries) for (const kw of keywords.length ? keywords : [""]) {
      const d = await getJson(`https://api.adzuna.com/v1/api/jobs/${c}/search/1?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}&results_per_page=50&content-type=application/json${kw ? `&what=${encodeURIComponent(kw)}` : ""}`);
      for (const j of d.results ?? []) out.push({ source: `adzuna:${c}`, external_id: String(j.id), company: j.company?.display_name ?? "", title: j.title?.replace(/<[^>]+>/g, "") ?? "", location: j.location?.display_name ?? "", remote: /remote/i.test(`${j.title} ${j.description}`), salary: j.salary_min ? `${Math.round(j.salary_min)}–${Math.round(j.salary_max)}` : "", url: j.redirect_url, description: text(j.description), posted_at: iso(j.created) });
    }
    return out;
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
export function matchesKeywords(title: string, keywords: string[], description = "") {
  if (!keywords.length) return true;
  const t = ` ${norm(title)} ${description ? norm(description.slice(0, 4000)) : ""} `;
  return keywords.some((k) => norm(k).split(/\s+/).filter(Boolean).every((w) => t.includes(w)));
}
export function isFresh(p: Posting, maxAgeDays: number) {
  if (!maxAgeDays || !p.posted_at) return true;
  return Date.now() - Date.parse(p.posted_at) <= maxAgeDays * 86_400_000;
}
/** Same role at the same company across sources (LinkedIn vs board) collapses to one item. */
export const dedupeKey = (p: { company: string; title: string }) => `${norm(p.company).replace(/\b(inc|ltd|llc|gmbh|pte|co|corp|corporation|limited)\b/g, "").trim()}|${norm(p.title).replace(/\((?:m\/w\/d|f\/m\/d|all genders|remote|hybrid)\)|\b(remote|hybrid|onsite)\b/g, "").trim()}`.replace(/\s+/g, " ");
// A country on either list also matches the short forms postings actually use.
const COUNTRY_ALIASES: Record<string, string[]> = {
  "united states": ["usa", "us", "u s", "u s a", "united states of america", "us only", "usa only"],
  "united kingdom": ["uk", "u k", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
  "germany": ["deutschland"], "netherlands": ["the netherlands", "holland"], "denmark": ["danmark"],
  "switzerland": ["schweiz", "suisse", "svizzera"], "spain": ["españa", "espana"], "italy": ["italia"], "sweden": ["sverige"],
  "austria": ["österreich", "osterreich"], "belgium": ["belgië", "belgie", "belgique"], "czech republic": ["czechia"],
  "united arab emirates": ["uae", "dubai", "abu dhabi"], "hong kong": ["hk"], "singapore": ["sg"],
};
const US_STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "));
const OTHER_COUNTRY = /\b(india|canada|australia|germany|deutschland|uk|united kingdom|mexico|brazil|china|japan|france|spain|italy|netherlands|ireland|singapore|philippines|nigeria|south africa|argentina|colombia|chile|peru|pakistan|bangladesh|malaysia|indonesia|vietnam|new zealand|europe|emea|apac|latam)\b/i;
// State codes that are also common country codes ("Berlin, DE", "Bengaluru, IN", "Toronto, CA") only count with a US hint or an unfamiliar city.
const AMBIGUOUS_STATE = new Set(["DE", "IN", "CA", "GA", "AL", "AR", "CO", "ID", "MA", "MD", "ME", "MT", "NE", "PA", "SC", "TN"]);
const NON_US_CITY = /\b(berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf|leipzig|dresden|hannover|nuremberg|nürnberg|bremen|bengaluru|bangalore|chennai|mumbai|delhi|hyderabad|pune|kolkata|gurgaon|gurugram|noida|toronto|vancouver|montreal|calgary|ottawa|edmonton|waterloo|tbilisi|tirana|buenos aires|bogotá|bogota|medellín|medellin|jakarta|rabat|casablanca|chișinău|chisinau|podgorica|valletta|niamey|panama city|victoria|tunis)\b/i;
/** "Austin, TX" / "New York, NY, USA" — a US state code after the city, unless the text points elsewhere. */
const looksAmerican = (loc: string) => {
  const m = /,\s*([A-Z]{2})(?:\s*,?\s*(USA?|U\.S\.A?\.?|United States))?\s*$/.exec(loc.trim());
  if (!m || !US_STATES.has(m[1]) || OTHER_COUNTRY.test(loc)) return false;
  return !AMBIGUOUS_STATE.has(m[1]) || !!m[2] || !NON_US_CITY.test(loc);
};
const words = (s: string) => ` ${norm(s).replace(/\./g, " ").replace(/\s+/g, " ").trim()} `;
const hasPhrase = (hay: string, t: string) => t.length <= 3 ? hay.includes(` ${t} `) : hay.includes(t); // short terms ("us", "ny") must be whole words
/** Does a posting's location satisfy one term from the settings? Substring for places, aliases for countries. */
export function locationHas(location: string, term: string): boolean {
  const l = words(location), t = words(term).trim();
  if (!t) return false;
  if (hasPhrase(l, t)) return true;
  if (COUNTRY_ALIASES[t]?.some((a) => hasPhrase(l, words(a).trim()))) return true;
  if (t === "united states" && looksAmerican(location)) return true;
  for (const [country, aliases] of Object.entries(COUNTRY_ALIASES)) // the user typed the alias ("USA"), the posting the country
    if (aliases.includes(t) && (l.includes(country) || (country === "united states" && looksAmerican(location)))) return true;
  return false;
}
export function matchesLocation(p: Posting, locations: string[]) {
  if (!locations.length) return true;
  return locations.some((l) => (norm(l).trim() === "remote" && p.remote) || locationHas(p.location ?? "", l));
}
/** Whole-word (plural-tolerant) on the title so "intern" doesn't hide "Internal Tools"; locations via locationHas. */
export function isExcluded(p: Posting, exclude: string[]) {
  const titles = [p.title, p.title_en].filter(Boolean).map((t) => words(t!));
  return exclude.some((x) => {
    const t = words(x).trim();
    if (!t) return false;
    const re = new RegExp(`(^| )${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?( |$)`);
    return titles.some((h) => re.test(h)) || locationHas(p.location ?? "", x);
  });
}

/**
 * Re-check what is already in the feed against the current filters: a term added later must
 * hide postings that are already there, and loosening a filter brings them back. Hidden items
 * keep their scores and come back automatically; they are not dismissed.
 */
export function applyFilters(s = feedSettings()) {
  const rows = db.prepare("SELECT id, status, title, title_en, location, remote, level, description FROM feed_items WHERE status IN ('new', 'hidden')").all() as any[];
  const hide = db.prepare("UPDATE feed_items SET status = 'hidden' WHERE id = ?"), show = db.prepare("UPDATE feed_items SET status = 'new' WHERE id = ?");
  let hidden = 0, restored = 0;
  for (const r of rows) {
    const p = { title: r.title, title_en: r.title_en, location: r.location ?? "", remote: !!r.remote, description: r.description ?? "" } as Posting;
    const ok = matchesLocation(p, s.locations) && !isExcluded(p, s.exclude)
      && matchesLevel((r.level as Level) || classifyLevel(r.title_en || r.title), s.levels)
      && matchesKeywords(r.title_en || r.title, s.keywords, s.matchIn === "text" ? p.description : "");
    if (!ok && r.status === "new") { hide.run(r.id); hidden++; }
    else if (ok && r.status === "hidden") { show.run(r.id); restored++; }
  }
  return { hidden, restored };
}

// ---------- store ----------

export function insertNew(postings: Posting[]): number {
  const ins = db.prepare(`INSERT OR IGNORE INTO feed_items (source, external_id, company, title, location, remote, salary, url, description, posted_at, dedupe_key, level, lang, title_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const knownUrl = db.prepare("SELECT 1 FROM feed_items WHERE url = ? UNION SELECT 1 FROM applications WHERE url = ?");
  const knownKey = db.prepare("SELECT 1 FROM feed_items WHERE dedupe_key = ?");
  let n = 0;
  const seenKeys = new Set<string>();
  for (const p of postings) {
    const key = dedupeKey(p);
    if (seenKeys.has(key) || knownUrl.get(p.url, p.url) || knownKey.get(key)) continue; // same posting via another source, or already tracked
    seenKeys.add(key);
    n += Number(ins.run(p.source, p.external_id, p.company, p.title, p.location, p.remote ? 1 : 0, p.salary, p.url, p.description, p.posted_at, key, p.level ?? classifyLevel(p.title_en || p.title), p.lang ?? "en", p.title_en ?? null).changes);
  }
  return n;
}
/** Drop stale, untouched items so the feed doesn't grow forever. */
export function purgeStale(maxAgeDays: number) {
  const days = Math.max(maxAgeDays * 2, 45);
  return Number(db.prepare(`DELETE FROM feed_items WHERE status IN ('new', 'hidden') AND created_at < datetime('now', ?) AND (posted_at IS NULL OR posted_at < date('now', ?))`).run(`-${days} days`, `-${days} days`).changes);
}
export function markSeen(ids: number[]) {
  if (!ids.length) return;
  db.prepare(`UPDATE feed_items SET seen = 1 WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
}

export function listFeed(status: string | null = null) {
  const where = status ? "WHERE status = ?" : "WHERE status NOT IN ('dismissed', 'hidden')";
  return db.prepare(`SELECT id, source, company, title, title_en, lang, level, location, remote, salary, url, posted_at, fit_score, fit_reason, ats_pct, ats_missing, seen, status, application_id, created_at, length(description) AS desc_len, substr(description, 1, 700) AS excerpt FROM feed_items ${where} ORDER BY (fit_score IS NULL), fit_score DESC, ats_pct DESC, posted_at DESC, id DESC LIMIT 500`).all(...(status ? [status] : []));
}
export const getFeedItem = (id: number) => db.prepare("SELECT * FROM feed_items WHERE id = ?").get(id) as any;
/** Unscored items worth a model call: best keyword coverage first, skipping ones below the ATS floor. */
export const unscoredIds = (limit: number, minAts = 0) => (db.prepare("SELECT id FROM feed_items WHERE fit_score IS NULL AND status = 'new' AND (ats_pct IS NULL OR ats_pct >= ?) ORDER BY ats_pct DESC, posted_at DESC, id DESC LIMIT ?").all(minAts, limit) as { id: number }[]).map((r) => r.id);
export const unscreenedIds = () => (db.prepare("SELECT id FROM feed_items WHERE ats_pct IS NULL AND status = 'new' ORDER BY id DESC LIMIT 2000").all() as { id: number }[]).map((r) => r.id);
export function feedCounts() {
  const s = feedSettings();
  const r = db.prepare("SELECT SUM(status='new' AND fit_score >= ?) AS hot, SUM(status='new' AND fit_score >= ? AND seen = 0) AS unseen_hot, SUM(status='new' AND fit_score IS NULL) AS unscored, SUM(status='new' AND fit_score IS NULL AND ats_pct IS NOT NULL AND ats_pct < ?) AS screened_out, SUM(status='new') AS open, SUM(status='hidden') AS hidden FROM feed_items").get(s.minScore, s.minScore, s.minAts) as any;
  return { hot: r.hot ?? 0, unseen_hot: r.unseen_hot ?? 0, unscored: r.unscored ?? 0, screened_out: r.screened_out ?? 0, open: r.open ?? 0, hidden: r.hidden ?? 0 };
}
