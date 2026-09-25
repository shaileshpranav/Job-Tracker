const STATUSES = ["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn"];
// Over and done with: nothing is ever due on these (mirrors CLOSED_STATUSES in db.ts).
const CLOSED_STATUSES = ["rejected", "withdrawn"];
const isClosed = (status) => CLOSED_STATUSES.includes(status);
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- icons: one monochrome line set, inherits the text colour ----------
const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  feed: '<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.2" fill="currentColor" stroke="none"/>',
  goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  tasks: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M4 7h9M18 7h2M4 17h4M13 17h7"/><circle cx="15.5" cy="7" r="2.2"/><circle cx="10.5" cy="17" r="2.2"/>',
  apps: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
  model: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  routes: '<path d="M3 12h5l3-4h3M3 12h5l3 4h3"/><path d="M14 8h6m-2.5-2.5L20 8l-2.5 2.5M14 16h6m-2.5-2.5L20 16l-2.5 2.5"/>',
  guard: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  resume: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  documents: '<path d="M15 3H9a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8z"/><path d="M15 3v5h4M5 8v12a1 1 0 0 0 1 1h9"/>',
  prompts: '<path d="M4 5h16v11H9l-5 4z"/>',
  plug: '<path d="M9 3v6M15 3v6"/><path d="M6 9h12v3a6 6 0 0 1-12 0z"/><path d="M12 18v3"/>',
  security: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  flame: '<path d="M12 2.5c.8 3.2 4.8 5.2 4.8 9.7a4.8 4.8 0 0 1-9.6 0c0-1.9.8-3.4 1.9-4.6.3 1.4 1 2.3 2.1 2.5C10.2 7.6 10.3 5 12 2.5z"/><path d="M12 21a2.6 2.6 0 0 1-2.6-2.6c0-1.3 1-2 1.4-3 .4 1 1.6 1.5 1.6 3A2.6 2.6 0 0 1 12 21z" fill="currentColor" stroke="none" opacity=".35"/>',
  pin: '<path d="M7 3h10v18l-5-4-5 4z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  package: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  sparkle: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>',
  cap: '<path d="M2 9l10-4 10 4-10 4z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 20c0-3-2-5-5-5.5"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M13 7l3 3"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  note: '<path d="M4 20h16M4 16l10-10 3 3L7 19z"/>',
  check: '<path d="M5 12l4 4L19 7"/>',
  logout: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M9 12h10"/>',
  back: '<path d="M19 12H5M11 5l-7 7 7 7"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

const state = { apps: [], filter: "all", sel: null, app: null, tab: "job", busy: null, profile: null, err: null, settings: null, modelCache: {}, editJob: false, docMode: "preview", tex: null, prompts: null, templates: null, style: null, jobs: [], notice: null, search: "", pasteFor: null, goals: null, celebrate: false, diffAgainst: "base", baseResume: null, feed: null, feedFilter: "hot", feedFacets: { q: "", loc: "", sources: [], levels: [], remoteOnly: false }, feedTest: null, sort: "recent", activity: null, checklistHidden: false, ats: null, atsOpen: false, baseEdit: null, guard: null, extensions: null, applyOpen: false, genNote: {}, drafts: {}, dup: null, pdf: null, settingsSection: "model", newMode: "capture", viewDoc: null, headOpen: false, statusOpen: false, feedCursor: -1, noticeAction: null, pendingDeletes: new Set() };
try { state.atsOpen = localStorage.getItem("atsOpen") === "1"; } catch { state.atsOpen = false; }
try { state.settingsSection = localStorage.getItem("settingsSection") || "model"; } catch {}

// ---------- drafts: unsaved edits survive tab switches, background re-renders and reloads ----------
// Any input/textarea with data-draft="key" is tracked: what you type is kept in state.drafts
// (mirrored to localStorage) until the matching save clears it, and put back whenever that
// field is rendered again. A field's defaultValue is its saved text, so editing back to the
// original stops it being a draft automatically. Keys are "<what>:<appId>:…" so an
// application's drafts can be dropped together.
try { state.drafts = JSON.parse(localStorage.getItem("drafts") || "{}") || {}; } catch {}
const persistDrafts = () => { try { localStorage.setItem("drafts", JSON.stringify(state.drafts)); } catch {} };
// A selector ending in ":" is a prefix ("job:7:" = every job field); anything else is one exact key,
// so "q:7:12" never matches "q:7:123".
const draftMatch = (key, sel) => sel.endsWith(":") ? key.startsWith(sel) : key === sel;
function clearDrafts(sel) {
  for (const k of Object.keys(state.drafts)) if (draftMatch(k, sel)) delete state.drafts[k];
  persistDrafts();
}
const hasDraft = (sel) => Object.keys(state.drafts).some((k) => draftMatch(k, sel));
const draftKeys = (sel) => Object.keys(state.drafts).filter((k) => draftMatch(k, sel));
// Drop drafts for questions that no longer exist. Drafts on superseded document versions are
// kept on purpose — renderDoc offers to restore or discard them.
function pruneDrafts(a) {
  const qIds = new Set(a.questions.map((q) => String(q.id)));
  for (const k of Object.keys(state.drafts)) {
    const [what, appId, x] = k.split(":");
    if (appId === String(a.id) && what === "q" && !qIds.has(x)) delete state.drafts[k];
  }
  persistDrafts();
}
// Hints (an "unsaved" pill, a Discard button, a Save button turning primary) carry the
// key or key prefix they care about, so one pill can cover a whole form.
function refreshDirtyHints() {
  for (const h of document.querySelectorAll("[data-dirty-for]")) h.hidden = !hasDraft(h.dataset.dirtyFor);
  for (const b of document.querySelectorAll("[data-dirty-primary]")) b.classList.toggle("primary", hasDraft(b.dataset.dirtyPrimary));
}
// Wire every data-draft field in freshly rendered HTML: restore its draft and watch it.
function hydrateDrafts(root) {
  for (const el of root.querySelectorAll("[data-draft]")) {
    const key = el.dataset.draft, saved = el.defaultValue, d = state.drafts[key];
    if (d != null && d !== saved) el.value = d;
    else if (d != null) delete state.drafts[key];
    el.classList.toggle("dirty", el.value !== saved);
    el.addEventListener("input", () => {
      if (el.value === saved) delete state.drafts[key]; else state.drafts[key] = el.value;
      persistDrafts(); el.classList.toggle("dirty", el.value !== saved); refreshDirtyHints();
    });
  }
  refreshDirtyHints();
}
const localDate = (offsetDays = 0) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// ---------- tiny Markdown renderer (headings, lists, emphasis, links) ----------
function mdInline(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\*)(.+?)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
// Plain text for pasting into ATS text boxes: headings and emphasis markers dropped, bullets kept.
function mdToText(md) {
  return String(md ?? "").replace(/\r/g, "")
    .replace(/^#{1,6}\s+(.*)$/gm, "$1")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "- ").replace(/^[ \t]*(\d+)[.)][ \t]+/gm, "$1. ")
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2").replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[ \t]*(-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "")
    .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, "$1")
    .replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
const answersText = (a) => a.questions.map((q) => `${q.question}\n\n${q.answer}`).join("\n\n---\n\n");
function mdToHtml(md) {
  const out = []; let list = null, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${mdInline(para.join(" "))}</p>`); para = []; } };
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)/.exec(line), li = /^\s*[-*+]\s+(.*)/.exec(line), oli = /^\s*\d+[.)]\s+(.*)/.exec(line);
    if (h) { flush(); close(); out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); }
    else if (li || oli) { flush(); const w = li ? "ul" : "ol"; if (list !== w) { close(); list = w; out.push(`<${w}>`); } out.push(`<li>${mdInline((li || oli)[1])}</li>`); }
    else if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flush(); close(); out.push("<hr>"); }
    else if (!line.trim()) { flush(); close(); }
    else { close(); para.push(line.trim()); }
  }
  flush(); close(); return out.join("\n");
}

// Line-level diff (LCS) — good enough to eyeball what changed between versions.
function renderDiff(a, b) {
  const A = a.split("\n"), B = b.split("\n"), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(`<div class="d-eq">${esc(A[i]) || "&nbsp;"}</div>`); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out.push(`<div class="d-del">${esc(A[i]) || "&nbsp;"}</div>`); i++; }
    else { out.push(`<div class="d-add">${esc(B[j]) || "&nbsp;"}</div>`); j++; }
  }
  while (i < n) out.push(`<div class="d-del">${esc(A[i++]) || "&nbsp;"}</div>`);
  while (j < m) out.push(`<div class="d-add">${esc(B[j++]) || "&nbsp;"}</div>`);
  return out.join("");
}

// SQLite timestamps are UTC without a zone marker; show them in local time.
function fmtTime(s, withDate = true) {
  if (!s) return "";
  const d = new Date(s.includes("T") || s.endsWith("Z") ? s : s.replace(" ", "T") + "Z");
  if (isNaN(d)) return s;
  return withDate ? d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || res.statusText); err.status = res.status; err.data = data; throw err; }
  return data;
}

// Runs an async action with a spinner. `fn` is started BEFORE the spinner
// re-renders the page so any form values it reads synchronously are still
// in the DOM; handlers must still read inputs before their first `await`.
async function run(label, fn) {
  state.err = null;
  let pending;
  try { pending = fn(); } catch (e) { state.err = e.message; render(true); return; }
  if (label) { state.busy = label; render(); }
  try { await pending; } catch (e) { state.err = e.message; }
  state.busy = null;
  // A rendering bug must never leave the spinner stuck: clear it first, then report.
  try { render(true); } catch (e) { $("#busyPill").hidden = true; state.err = `Display error: ${e.message}`; console.error(e); try { render(true); } catch {} }
}

// ---------- tasks (queue) ----------
const activeJobs = () => state.jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "waiting");
const waitingJobs = () => state.jobs.filter((j) => j.status === "waiting");
const needOf = (j) => { try { return JSON.parse(j.need || "{}"); } catch { return {}; } };

// POST to an endpoint that enqueues a job; shows a notice instead of blocking.
async function enqueue(url, body, label) {
  state.err = null; state.dup = null;
  try {
    const r = await api("POST", url, body);
    if (!r.job && r.application_id) { // nothing to queue — it already exists
      if (state.sel === "feed") await loadFeed();
      notify(r.existing ? `Already tracked as ${r.existing.company} · ${r.existing.role} — opening it` : "Already tracked — opening it");
      return open(r.application_id);
    }
    const { job } = r;
    await refreshJobs();
    const position = activeJobs().filter((j) => j.status === "queued" && j.id < job.id).length;
    notify(`${job.label} — ${job.status === "running" ? "started" : position ? `queued (${position} ahead)` : "queued"}`);
  } catch (e) {
    if (e.data?.existing) { state.dup = { existing: e.data.existing, url, body }; state.sel = "new"; state.app = null; } // let the person decide
    else state.err = e.message;
  }
  render(true);
}

// Clipboard API first; the old execCommand path covers browsers/embeds that refuse it.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.focus(); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch {} ta.remove(); return ok;
}
function notify(text, action = null, ms = 3500) {
  state.notice = text; state.noticeAction = action; render(true);
  clearTimeout(notify.t); notify.t = setTimeout(() => { state.notice = null; state.noticeAction = null; render(true); }, ms);
}
// Destructive actions happen on screen at once and on the server a few seconds later, so the
// notice can offer Undo instead of a confirm() dialog: apply() changes local state, commit()
// talks to the server when the window closes, revert() puts things back if Undo is clicked.
function undoable({ text, apply, commit, revert, delay = 6000 }) {
  let done = false;
  apply();
  const timer = setTimeout(() => { if (!done) { done = true; commit().catch((e) => { state.err = e.message; revert(); render(true); }); } }, delay);
  notify(text, { label: "Undo", fn: () => { if (done) return; done = true; clearTimeout(timer); state.notice = null; state.noticeAction = null; revert(); } }, delay);
}

async function refreshJobs() {
  const prev = new Map(state.jobs.map((j) => [j.id, j.status]));
  state.jobs = await api("GET", "/api/jobs").catch(() => state.jobs);
  for (const j of state.jobs) {
    const was = prev.get(j.id);
    if (!was) continue;
    if ((was === "queued" || was === "running") && (j.status === "done" || j.status === "error")) await onJobFinished(j);
    else if (was !== "waiting" && j.status === "waiting") notify(`${j.label} needs you — ${needOf(j).reason || "see Tasks"}`);
  }
}

// A job we were watching just finished: refresh what it touched.
async function onJobFinished(j) {
  const result = j.result ? JSON.parse(j.result) : {};
  await loadList();
  if (j.status === "error") { notify(`✗ ${j.label}: ${j.error}`); return; }
  notify(`✓ ${j.label}`);
  if (j.type === "import") { state.profile = await api("GET", "/api/profile"); return; }
  if (j.type === "feed_refresh" || j.type === "feed_score") {
    const bad = Object.entries(result.report || {}).filter(([, v]) => String(v).startsWith("failed"));
    notify(`✓ ${j.label} — ${j.type === "feed_refresh" ? `${result.added} new, ${result.translated ? `${result.translated} translated, ` : ""}${result.screened ? `${result.screened} keyword-screened, ` : ""}` : ""}${result.scored} scored, ${result.hot} hot${result.hidden ? `, ${result.hidden} hidden by filters` : ""}${result.restored ? `, ${result.restored} back` : ""}${result.purged ? `, ${result.purged} stale removed` : ""}${bad.length ? ` · ${bad.length} source${bad.length > 1 ? "s" : ""} failed: ${bad.map(([k, v]) => `${k} (${String(v).replace("failed: ", "")})`).join(", ")}` : ""}`);
    if (state.sel === "feed") { await loadFeed(); } else { const f = await api("GET", "/api/feed?status=open").catch(() => null); state.feedHot = f?.counts?.unseen_hot ?? 0; }
    return;
  }
  if (j.type === "capture" && state.sel === "feed") { await loadFeed(); return; }
  if (j.type === "learn") { state.style = null; notify(`✓ ${j.label} — ${result.rules} rule${result.rules === 1 ? "" : "s"} now guide future ${result.kind === "resume" ? "resumes" : "cover letters"} (see Settings)`); }
  if (j.type === "capture" && result.application_id && (state.sel === "new" || state.sel === null || state.sel === "tasks")) {
    state.tab = "job"; await open(result.application_id); return;
  }
  if (state.app && state.app.id === (j.application_id ?? result.application_id)) {
    state.app = await api("GET", `/api/applications/${state.app.id}`);
    if (j.type === "generate") { state.tab = result.what === "cover_letter" ? "cover_letter" : "resume"; state.docMode = "preview"; state.tex = null; state.viewDoc = null; state.ats = null; }
    if (j.type === "condense") { state.docMode = "preview"; state.tex = null; state.viewDoc = null; }
    if (j.type === "prep") state.tab = "prep";
  }
}

// Poll: fast while something is active, slow otherwise.
(function pollJobs() {
  const delay = activeJobs().length ? 2000 : 15000;
  setTimeout(async () => {
    if (state.settings) {
      await refreshJobs();
      const typing = ["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName);
      if (!typing && !state.busy) render();
    }
    pollJobs();
  }, delay);
})();

function jobRow(j, compact) {
  const t = (s) => fmtTime(s);
  const secs = (a, b) => Math.max(1, Math.round((Date.parse(b.replace(" ", "T") + "Z") - Date.parse(a.replace(" ", "T") + "Z")) / 1000));
  const dur = j.started_at && j.finished_at ? `${secs(j.started_at, j.finished_at)}s` : "";
  const mark = { queued: "◦", running: '<span class="spinner"></span>', waiting: `<span style="color:var(--warn)">${icon("warn")}</span>`, done: '<span style="color:var(--ok)">✓</span>', error: '<span style="color:var(--bad)">✗</span>', cancelled: '<span class="muted">–</span>' }[j.status];
  return `<div class="job ${j.status}" data-job="${j.id}">
    <span class="job-icon">${mark}</span>
    <div class="job-main"><b>${esc(j.label)}</b>
      <div class="muted">${j.status === "running" ? esc(j.progress || "Working…") : j.status === "queued" ? "Queued" : j.status === "waiting" ? `<span style="color:var(--warn)">Waiting for you — ${esc(needOf(j).reason || "needs input")}</span>` : j.status === "error" ? `<span class="err">${esc(j.error || "failed")}</span>` : j.status}${dur ? ` · ${dur}` : ""}${compact ? "" : ` · ${t(j.created_at)}`}</div></div>
    <div class="job-actions">
      ${j.application_id ? `<button class="ghost" data-job-open="${j.application_id}" title="Open application">↗</button>` : ""}
      ${j.status === "queued" || j.status === "running" ? `<button data-job-cancel="${j.id}">Cancel</button>` : ""}
      ${j.status === "error" || j.status === "cancelled" ? `<button data-job-retry="${j.id}">Retry</button>` : ""}
    </div></div>`;
}

/**
 * A task parked on a human-verification check. The app never tries to pass the
 * check itself — you open the page, clear it, and hand the page back.
 */
function renderNeedsYou() {
  return waitingJobs().map((j) => {
    const n = needOf(j);
    const open = state.pasteFor === j.id;
    return `<div class="card needs" data-need="${j.id}">
      <div class="toolbar" style="margin-bottom:6px"><h3 style="margin:0">${icon("warn")} ${esc(j.label)} needs you</h3><div class="sp"></div><span class="muted">${esc(n.host || "")}</span></div>
      <p style="margin:0 0 10px">${esc(n.message || "This task is waiting for input.")} Open the posting, clear the check yourself, then hand the page over — the app doesn't try to get past these.</p>
      <div class="toolbar" style="margin:0">
        ${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener"><button class="primary">Open the posting ↗</button></a>` : ""}
        <button data-resume="${j.id}">I've cleared it — try again</button>
        <button data-paste="${j.id}" class="${open ? "on" : ""}">Paste the page text</button>
        <div class="sp"></div>
        <button class="ghost" data-job-cancel="${j.id}">Cancel task</button>
      </div>
      ${open ? `<div style="margin-top:10px">
        <textarea id="pasteText" placeholder="Select the whole posting page (⌘A, ⌘C) and paste it here…" style="min-height:140px"></textarea>
        <div class="toolbar" style="margin:8px 0 0"><button class="primary" data-paste-save="${j.id}">Use this text</button><span class="muted">Or click the Save to Job Tracker bookmarklet on the cleared page — it resumes this task automatically.</span></div>
      </div>` : `<p class="muted" style="margin:8px 0 0">Tip: with the Save to Job Tracker bookmarklet on your bookmarks bar, one click on the cleared page hands it over and resumes this task.</p>`}
    </div>`;
  }).join("");
}

// ---------- job feed ----------
async function loadFeed() {
  const status = { hot: "open", open: "open", unscored: "open", tracked: "tracked", dismissed: "dismissed", hidden: "hidden" }[state.feedFilter] || "open";
  const marking = state.feedFilter === "hot" || state.feedFilter === "open";
  state.feed = await api("GET", `/api/feed?status=${status}${marking ? "&seen=1" : ""}`).catch(() => state.feed);
  state.feedHot = marking ? 0 : state.feed?.counts?.unseen_hot ?? 0; // viewing the list clears the badge
}

function renderFeed() {
  const f = state.feed;
  if (!f) return `${errBox()}<div class="card"><span class="spinner"></span>Loading feed…</div>`;
  const st = f.settings, c = f.counts;
  let items = f.items;
  if (state.feedFilter === "hot") items = items.filter((i) => i.status === "new" && i.fit_score >= st.minScore);
  if (state.feedFilter === "unscored") items = items.filter((i) => i.fit_score == null);
  // Filters on what's currently shown (portal, location, career level, remote, search) — display-only,
  // separate from the feed settings that decide what gets pulled and kept in the first place.
  const fac = state.feedFacets;
  const tabItems = items; // before facet filters, so the facet option lists reflect this tab, not the narrowed result
  const sourceOptions = [...new Set(tabItems.map((i) => i.source))].sort();
  const levelOptions = (f.levels || []).filter((l) => tabItems.some((i) => i.level === l.key));
  if (fac.q.trim()) { const q = fac.q.trim().toLowerCase(); items = items.filter((i) => `${i.title_en || i.title} ${i.company}`.toLowerCase().includes(q)); }
  if (fac.loc.trim()) { const l = fac.loc.trim().toLowerCase(); items = items.filter((i) => (i.location || "").toLowerCase().includes(l) || (l === "remote" && i.remote)); }
  if (fac.sources.length) items = items.filter((i) => fac.sources.includes(i.source));
  if (fac.levels.length) items = items.filter((i) => fac.levels.includes(i.level));
  if (fac.remoteOnly) items = items.filter((i) => i.remote);
  const facetsActive = fac.q.trim() || fac.loc.trim() || fac.sources.length || fac.levels.length || fac.remoteOnly;
  const configured = st.boards.length || Object.values(st.aggregators).some(Boolean);
  const chips = [["hot", `${icon("flame")} Hot ${c.hot}${c.unseen_hot ? ` <span class="tb">${c.unseen_hot} new</span>` : ""}`], ["open", `All open ${c.open}`], ["unscored", `Unscored ${c.unscored}`], ["tracked", "Tracked"], ["dismissed", "Dismissed"], ...(c.hidden ? [["hidden", `Hidden by filters ${c.hidden}`]] : [])];
  const dots = (n) => n == null ? '<span class="muted" title="Not scored yet">–</span>' : `<span class="dots small">${[1,2,3,4,5].map((i) => `<span class="dot ${i <= n ? "on f" + n : ""}"></span>`).join("")}</span>`;
  const atsChip = (i) => i.ats_pct == null ? "" : `<span class="pill ${i.ats_pct >= 60 ? "ok" : i.ats_pct >= st.minAts ? "" : "bad"}" title="Keyword coverage of your base resume against this posting (deterministic)">${i.ats_pct}% keywords</span>`;
  const missing = (i) => { try { const m = JSON.parse(i.ats_missing || "[]"); return m.length ? `<span class="muted">missing: ${m.map(esc).join(", ")}</span>` : ""; } catch { return ""; } };
  return `${errBox()}
    <div class="card">
      <div class="toolbar" style="margin:0">
        <div class="head-title"><h2>Job feed</h2><div class="sub"><span>${f.lastRefresh ? `Last refreshed ${fmtTime(f.lastRefresh)}` : "Never refreshed"}</span>${st.autoHours ? `<span>auto every ${st.autoHours}h</span>` : ""}<span>${st.keywords.length ? `keywords: ${esc(st.keywords.join(", "))}` : "<b>no keywords set</b>"}</span>${c.screened_out ? `<span title="Unscored postings whose keyword coverage is below ${st.minAts}% — not sent to the model">${c.screened_out} screened out</span>` : ""}</div></div>
        <div class="sp"></div>
        ${c.unscored - c.screened_out > 0 ? `<button id="feedScore" title="Triage the unscored postings with the feed model">★ Score ${Math.min(c.unscored - c.screened_out, st.scorePerRefresh)} unscored</button>` : ""}
        <button class="primary" id="feedRefresh" ${configured ? "" : "disabled"}>${icon("refresh")} Refresh feed</button>
      </div>
    </div>
    ${configured ? "" : `<div class="banner">Nothing configured yet — add a few keywords and either company boards or an aggregator below, then Refresh.</div>`}
    ${state.feedFilter === "hidden" ? `<div class="banner">These no longer pass your filters (locations, exclusions, career levels or keywords). They come back on their own when the filters change; scores are kept. To keep one anyway, track it.</div>` : ""}
    <div class="toolbar" style="margin-bottom:12px"><div class="filters" style="border:0;padding:0">${chips.map(([k, n]) => `<button data-feed-filter="${k}" class="${state.feedFilter === k ? "on" : ""}">${n}</button>`).join("")}</div><div class="sp"></div>
      ${state.feedFilter === "hot" && items.length ? `<button class="ghost" data-bulk="track_hot" title="Create applications for every hot posting (up to 20)">${icon("plus")} Track all hot</button>` : ""}
      ${state.feedFilter === "open" || state.feedFilter === "unscored" ? `<button class="ghost" data-bulk="dismiss_low" title="Dismiss everything scored below the hot threshold">× Dismiss below ${st.minScore}</button>${c.screened_out ? `<button class="ghost" data-bulk="dismiss_screened" title="Dismiss unscored postings with keyword coverage below ${st.minAts}%">× Dismiss screened-out (${c.screened_out})</button>` : ""}` : ""}
    </div>
    <div class="toolbar" style="margin-bottom:12px;flex-wrap:wrap;row-gap:8px">
      <input id="feedSearch" placeholder="Search title or company…" value="${esc(fac.q)}" style="width:190px">
      <input id="feedLocFilter" placeholder="Filter by location…" value="${esc(fac.loc)}" style="width:160px">
      <label style="display:inline-flex;align-items:center;gap:5px;margin:0"><input type="checkbox" id="feedRemoteOnly" style="width:auto" ${fac.remoteOnly ? "checked" : ""}>Remote only</label>
      ${sourceOptions.length > 1 ? `<div class="filters" style="border:0;padding:0" title="Portal">${sourceOptions.map((s) => `<button data-feed-src="${esc(s)}" class="${fac.sources.includes(s) ? "on" : ""}">${esc(s)}</button>`).join("")}</div>` : ""}
      ${levelOptions.length > 1 ? `<div class="filters" style="border:0;padding:0" title="Career level">${levelOptions.map((l) => `<button data-feed-lvl="${esc(l.key)}" class="${fac.levels.includes(l.key) ? "on" : ""}">${esc(l.label)}</button>`).join("")}</div>` : ""}
      ${facetsActive ? `<button class="ghost" id="feedFacetClear">× Clear filters</button>` : ""}
    </div>
    ${items.length ? items.map((i, idx) => `<div class="feed-item ${i.fit_score >= st.minScore ? "hot" : ""} ${!i.seen && i.status === "new" ? "unseen" : ""} ${idx === state.feedCursor ? "cur" : ""}" data-feed-idx="${idx}" data-feed-id="${i.id}">
      <div class="feed-score">${dots(i.fit_score)}${i.fit_score != null ? `<b>${i.fit_score}</b>` : ""}</div>
      <div class="feed-main">
        <div class="feed-title">${!i.seen && i.status === "new" ? '<span class="newdot" title="New since you last looked"></span>' : ""}<b title="${i.title_en ? `Original: ${esc(i.title)}` : ""}">${esc(i.title_en || i.title)}</b>${i.title_en ? ` <span class="pill" title="Translated from ${esc((i.lang || "").toUpperCase())} — original: ${esc(i.title)}">${esc((i.lang || "").toUpperCase())} → EN</span>` : i.lang && i.lang !== "en" ? ` <span class="pill warn" title="Not translated">${esc(i.lang.toUpperCase())}</span>` : ""} <span class="muted">at</span> ${esc(i.company)}</div>
        <div class="muted feed-meta">${[i.level ? `<span class="pill">${esc(i.level)}</span>` : "", i.location ? `<span title="${esc(i.location)}">${esc(i.location.length > 60 ? i.location.slice(0, 57) + "…" : i.location)}</span>` : "", i.remote ? "remote" : "", i.salary ? esc(i.salary) : "", i.posted_at || "", `<span class="pill">${esc(i.source)}</span>`, atsChip(i), i.desc_len ? "" : '<span title="The API gave no description; tracking will fetch the page">no text</span>'].filter(Boolean).map((x) => `<span>${x}</span>`).join("")}</div>
        ${i.fit_reason ? `<div class="feed-reason">${esc(i.fit_reason)}</div>` : ""}
        ${i.ats_missing && i.fit_score == null ? `<div class="feed-reason">${missing(i)}</div>` : ""}
        ${i.excerpt ? `<details class="feed-more"><summary>Preview</summary><div class="muted" style="white-space:pre-wrap;margin-top:6px">${esc(i.excerpt)}${i.desc_len > 700 ? "…" : ""}</div>${i.ats_missing && i.fit_score != null ? `<div style="margin-top:6px">${missing(i)}</div>` : ""}</details>` : ""}
      </div>
      <div class="feed-actions">
        ${i.status === "tracked" && i.application_id ? `<button class="primary" data-open-app="${i.application_id}">Open application ↗</button>`
          : `<button class="primary" data-feed-track="${i.id}" title="Create an application from this posting (full extraction + fit score)">${icon("plus")} Track</button>`}
        <a href="${esc(i.url)}" target="_blank" rel="noopener"><button class="ghost">Posting ↗</button></a>
        ${i.fit_score == null && i.status === "new" ? `<button class="ghost" data-feed-score1="${i.id}" title="Score this one with the model">★</button>` : ""}
        ${i.status === "dismissed" ? `<button class="ghost" data-feed-restore="${i.id}">Restore</button><button class="ghost" data-feed-delete="${i.id}" title="Delete permanently">Delete</button>` : i.status === "hidden" ? `<button class="ghost" data-feed-delete="${i.id}" title="Delete permanently">Delete</button>` : `<button class="ghost" data-feed-dismiss="${i.id}" title="Remove from the feed (find it again under Dismissed)">× Remove</button>`}
      </div>
    </div>`).join("") : `<div class="card muted">${facetsActive ? `Nothing matches these filters.` : state.feedFilter === "hot" ? `Nothing scored ${st.minScore}+ yet. ${c.unscored ? "Score the unscored postings, or" : "Refresh the feed, or"} lower the threshold below.` : "Nothing here."}</div>`}
    ${state.feedFilter === "dismissed" && items.length ? `<div class="toolbar"><button class="ghost" id="feedPurge">Delete all dismissed</button></div>` : ""}

    <div class="card"><details ${configured ? "" : "open"}><summary style="cursor:pointer;font-weight:600">Feed settings</summary>
      <div class="grid2" style="margin-top:12px">
        <div class="field"><label>Keywords (one per line — all words of a line must appear)</label><textarea id="fKeywords" placeholder="AI engineer\nmachine learning engineer\nforward deployed">${esc(st.keywords.join("\n"))}</textarea>
          <div class="seg" style="margin-top:6px"><button data-matchin="title" class="${st.matchIn === "title" ? "on" : ""}">in the title</button><button data-matchin="text" class="${st.matchIn === "text" ? "on" : ""}">title or description</button></div></div>
        <div class="field"><label>Locations to include (one per line; "remote" matches remote roles; empty = anywhere)</label><textarea id="fLocations" placeholder="Singapore\nremote\nDenmark\nCopenhagen">${esc(st.locations.join("\n"))}</textarea></div>
        <div class="field"><label>Exclude if title/location contains</label><textarea id="fExclude" style="min-height:60px">${esc(st.exclude.join("\n"))}</textarea></div>
        <div class="field"><label>Company boards (one per line)</label><textarea id="fBoards" placeholder="greenhouse:stripe\nlever:spotify\nashby:ramp">${esc(st.boards.join("\n"))}</textarea>
          <div class="toolbar" style="margin:6px 0 0"><input id="fDiscover" placeholder="Paste any careers page URL (or company site) to find its board…" style="flex:1"><button id="fDiscoverBtn">Find board</button></div>
          ${state.feedTest ? `<div class="muted" style="margin-top:4px">${state.feedTest.ok ? `✓ <code>${esc(state.feedTest.board)}</code> — ${state.feedTest.count} postings, e.g. ${esc(state.feedTest.sample.join(" · "))}${state.feedTest.guessed ? ` <span class="pill warn">guessed from the domain — check the titles look like this company</span>` : ""} <button data-add-board="${esc(state.feedTest.board)}" style="margin-left:6px">Add</button>` : `<span class="err">✗ ${esc(state.feedTest.error)}</span>`}</div>` : ""}</div>
      </div>
      <div class="field"><label>Career levels to keep (classified from the title)</label><div class="toolbar" style="margin:0">
        ${f.levels.map((l) => `<label style="display:inline-flex;align-items:center;gap:6px;margin:0"><input type="checkbox" data-level="${l.key}" ${st.levels.includes(l.key) ? "checked" : ""} style="width:auto">${esc(l.label)}</label>`).join("")}
      </div></div>
      <div class="field"><label style="display:inline-flex;align-items:center;gap:8px"><input type="checkbox" id="fTranslate" ${st.autoTranslate ? "checked" : ""} style="width:auto"> Translate non-English postings to English (titles for matching; captured descriptions in full) — uses the “Translate” task model</label></div>
      <div class="field"><label>Aggregators</label><div class="toolbar" style="margin:0">
        ${Object.entries(f.aggregators).map(([k, n]) => `<label style="display:inline-flex;align-items:center;gap:6px;margin:0"><input type="checkbox" data-agg="${k}" ${st.aggregators[k] ? "checked" : ""} style="width:auto">${esc(n)}</label>`).join("")}
      </div>
      ${st.aggregators.adzuna ? `<div class="toolbar" style="margin:8px 0 0"><input id="fAdzId" placeholder="Adzuna app id" value="${esc(st.adzuna.appId)}" style="width:160px"><input id="fAdzKey" type="password" placeholder="Adzuna app key" value="${esc(st.adzuna.appKey)}" style="width:260px"><span class="muted">free at developer.adzuna.com · countries come from your locations (sg, de, gb, us…)</span></div>` : ""}</div>
      <div class="grid3">
        <div class="field"><label>Hot at score ≥</label><input id="fMin" type="number" min="1" max="5" value="${st.minScore}"></div>
        <div class="field"><label>Skip model scoring under keyword coverage (%)</label><input id="fMinAts" type="number" min="0" max="100" value="${st.minAts}"></div>
        <div class="field"><label>Max postings scored per refresh</label><input id="fCap" type="number" min="0" max="200" value="${st.scorePerRefresh}"></div>
        <div class="field"><label>Ignore postings older than (days)</label><input id="fAge" type="number" min="0" max="365" value="${st.maxAgeDays}"></div>
        <div class="field"><label>Auto-refresh every (hours, 0 = off)</label><input id="fAuto" type="number" min="0" max="168" value="${st.autoHours}"></div>
      </div>
      <div class="toolbar" style="margin:0"><button class="primary" id="fSave">Save feed settings</button><span class="muted">Every new posting is keyword-screened against your base resume(s) for free; only the promising ones go to the “Feed triage” model.</span></div>
    </details></div>`;
}

// ---------- goals & achievements ----------
async function loadGoals() { state.goals = await api("GET", "/api/goals").catch(() => state.goals); }

function ring(p, size = 96) {
  const r = 34, c = 2 * Math.PI * r, off = c * (1 - (p.pct || 0) / 100);
  return `<div class="ring ${p.met ? "met" : ""}" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 80 80"><circle class="ring-bg" cx="40" cy="40" r="${r}"/><circle class="ring-fg" cx="40" cy="40" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>
    <div class="ring-text"><b>${p.count}</b><small>/ ${p.goal || "–"}</small></div>
  </div>`;
}

function renderGoals() {
  const g = state.goals;
  if (!g) return `${errBox()}<div class="card"><span class="spinner"></span>Loading…</div>`;
  const { day, week, month } = g.periods;
  const unlocked = g.achievements.filter((a) => a.unlocked_at), locked = g.achievements.filter((a) => !a.unlocked_at);
  const cols = []; for (let i = 0; i < g.heatmap.length; i += 7) cols.push(g.heatmap.slice(i, i + 7));
  const heat = (d) => d.rest ? "rest" : d.count === 0 ? "" : d.met ? "l3" : d.count >= Math.max(1, Math.ceil(g.goals.daily / 2)) ? "l2" : "l1";
  const monthLabel = (col, i) => { const d = col[0].date; const prev = cols[i - 1]?.[0].date; return (!prev || d.slice(0, 7) !== prev.slice(0, 7)) ? new Date(d + "T00:00").toLocaleString([], { month: "short" }) : ""; };
  return `${errBox()}
    <div class="card level">
      <div class="toolbar" style="margin:0">
        <div class="lvl-badge">${g.level.n}</div>
        <div class="head-title"><h2>Level ${g.level.n} — ${esc(g.level.name)}</h2><div class="sub"><span>${g.xp} XP</span><span>${g.level.next - g.xp} to level ${g.level.n + 1}</span><span>${g.total} application${g.total === 1 ? "" : "s"} sent</span></div></div>
        <div class="sp"></div>
        <div class="streak ${g.streak ? "hot" : ""}" title="Consecutive days hitting your daily goal${g.goals.weekends ? "" : " (weekends are rest days)"}"><span>${icon("flame")}</span><b>${g.streak}</b><small>day streak<br>best ${g.best}</small></div>
      </div>
      <div class="xp"><div style="width:${g.level.pct}%"></div></div>
    </div>

    <div class="card">
      <div class="rings">
        ${[day, week, month].map((p) => `<div class="ring-wrap">${ring(p)}<div class="ring-label"><b>${esc(p.label)}</b><small>${p.met ? '<span style="color:var(--ok)">goal met ✓</span>' : p.goal ? `${p.goal - p.count} to go` : "no goal set"}</small></div></div>`).join("")}
      </div>
      <p class="muted" style="margin:12px 0 0">Counts applications by their <b>applied</b> date — move a card to <i>applied</i> (or set the date) and it lands here. XP: 10 per application, +25 per daily goal, +75 weekly, +200 monthly, +5 per streak day.</p>
    </div>

    <div class="card"><h3>Last 16 weeks</h3>
      <div class="heat-wrap"><div class="heat-months">${cols.map((c, i) => `<span>${monthLabel(c, i)}</span>`).join("")}</div>
      <div class="heat">${cols.map((c) => `<div class="heat-col">${c.map((d) => `<div class="heat-cell ${heat(d)} ${d.date === g.today ? "today" : ""}" title="${d.date}: ${d.count} applied${d.met ? " · goal met" : ""}${d.rest ? " · rest day" : ""}"></div>`).join("")}</div>`).join("")}</div></div>
      <div class="muted" style="margin-top:6px;font-size:12px">Less <span class="heat-cell l1 inline"></span><span class="heat-cell l2 inline"></span><span class="heat-cell l3 inline"></span> goal met</div>
    </div>

    <div class="card"><div class="toolbar"><h3 style="margin:0">Achievements</h3><div class="sp"></div><span class="muted">${unlocked.length} / ${g.achievements.length}</span></div>
      <div class="badges">
        ${unlocked.map((a) => `<div class="badge on" title="Unlocked ${fmtTime(a.unlocked_at)}"><span class="badge-icon">${a.icon}</span><b>${esc(a.name)}</b><small>${esc(a.hint)}</small></div>`).join("")}
        ${locked.map((a) => `<div class="badge" title="Locked"><span class="badge-icon">${a.icon}</span><b>${esc(a.name)}</b><small>${esc(a.hint)}</small></div>`).join("")}
      </div>
    </div>

    ${outcomesCard(g.outcomes)}

    <div class="card"><h3>Targets</h3>
      <div class="grid3">
        <div class="field"><label>Per day</label><input id="gDaily" type="number" min="0" max="50" value="${g.goals.daily}"></div>
        <div class="field"><label>Per week</label><input id="gWeekly" type="number" min="0" max="300" value="${g.goals.weekly}"></div>
        <div class="field"><label>Per month</label><input id="gMonthly" type="number" min="0" max="1000" value="${g.goals.monthly}"></div>
      </div>
      <div class="field"><label>Nudge me to follow up after</label><div class="toolbar" style="margin:0"><input id="gFollow" type="number" min="0" max="90" value="${g.goals.followupDays}" style="width:90px"><span class="muted">days in <i>applied</i> / <i>screening</i> with no reply (0 = off). Shows as due in the list.</span></div></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink)"><input type="checkbox" id="gWeekends" ${g.goals.weekends ? "checked" : ""} style="width:auto"> Count weekends (untick to make Sat/Sun rest days that don't break a streak)</label>
      <div class="toolbar" style="margin:12px 0 0"><button class="primary" id="gSave">Save targets</button><span class="muted">Set a target to 0 to ignore it.</span></div>
    </div>`;
}

// Rows of {label, sent, advanced, offers, advanceRate} as mini bars — how outcomes break down by resume/fit.
function outcomeRows(rows, empty) {
  if (!rows.length) return `<p class="muted">${empty}</p>`;
  return rows.map((r) => `<div class="perf-row"><span class="sp">${esc(r.label)}</span><span class="muted">${r.sent} sent</span><div class="goal-bar perf-bar" title="${r.advanced} advanced${r.offers ? `, ${r.offers} offer${r.offers === 1 ? "" : "s"}` : ""}"><div style="width:${r.advanceRate}%"></div></div><b class="pct">${r.advanceRate}%</b></div>`).join("");
}
function outcomesCard(o) {
  if (!o || o.total < 3) return "";
  return `<div class="card"><h3>What's working</h3>
    <p class="muted" style="margin-top:0">Share of sent applications that reached screening, interview or offer at any point — even ones later rejected.</p>
    ${o.byResume.length > 1 ? `<h4 style="margin:14px 0 4px">By base resume</h4>${outcomeRows(o.byResume, "")}` : ""}
    <h4 style="margin:14px 0 4px">By fit score</h4>${outcomeRows(o.byFit, "Not enough scored applications yet.")}
  </div>`;
}

// Compact sidebar widget: today's progress + streak.
function goalWidget() {
  const g = state.goals; if (!g) return "";
  const d = g.periods.day;
  const pct = d.goal ? Math.min(100, Math.round((d.count / d.goal) * 100)) : 0;
  return `<div class="goal-mini ${d.met ? "met" : ""}" id="goalMini" title="Open goals">
    <span class="muted">${icon("goals")}</span><div class="goal-bar"><div style="width:${pct}%"></div></div><b>${d.count}/${d.goal || "–"}</b><span class="muted">today</span>
    <span class="streak-mini ${g.streak ? "hot" : ""}">${icon("flame")}${g.streak}</span></div>`;
}

// Toasts for what a status change just achieved.
function celebrate(c) {
  if (!c) return;
  const msgs = [];
  for (const h of c.hits) msgs.push(`${h === "Today" ? "Daily" : h === "This week" ? "Weekly" : "Monthly"} goal hit!`);
  for (const a of c.unlocked) msgs.push(`${a.icon} Achievement unlocked: ${a.name}`);
  if (!msgs.length) return;
  state.notice = msgs.join("  ·  "); state.celebrate = true; render(true);
  clearTimeout(notify.t); notify.t = setTimeout(() => { state.notice = null; state.celebrate = false; render(true); }, 6000);
}

function renderTasks() {
  const active = activeJobs().filter((j) => j.status !== "waiting"), past = state.jobs.filter((j) => j.status !== "waiting" && !active.includes(j));
  return `${errBox()}
    <div class="card"><div class="toolbar"><h2 style="margin:0">Tasks</h2><div class="sp"></div><span class="muted">${active.length ? `${active.length} active` : "idle"} · runs one at a time</span></div>
      ${active.length ? active.map((j) => jobRow(j)).join("") : '<p class="muted">Nothing running. Actions like Capture, Generate, Fit score and Draft answers queue here and run in the background — you can keep working meanwhile.</p>'}
    </div>
    <div class="card"><div class="toolbar"><h3 style="margin:0">History</h3><div class="sp"></div>${past.length ? `<button id="clearJobs">Clear</button>` : ""}</div>
      ${past.length ? past.map((j) => jobRow(j)).join("") : '<p class="muted">No finished tasks yet.</p>'}
    </div>`;
}

// Inline status for the current application on a tab.
function jobBadge(appId, types) {
  const js = activeJobs().filter((j) => j.application_id === appId && j.status !== "waiting" && types.includes(j.type));
  if (!js.length) return "";
  return `<div class="banner working"><span class="spinner"></span>${js.map((j) => `<b>${esc(j.label)}</b> — ${j.status === "running" ? esc(j.progress || "working…") : "queued"}`).join(" · ")}</div>`;
}

// ---------- data ----------
async function loadList() { state.apps = await api("GET", "/api/applications"); }
async function open(id) {
  let app;
  try { app = await api("GET", `/api/applications/${id}`); }
  catch (e) { notify(`✗ That application no longer exists (${e.message}).`); await loadList(); if (state.sel === "feed") await loadFeed(); render(true); return; }
  if (state.app?.id !== id) dropPdf();
  state.sel = id; state.editJob = false; state.docMode = "preview"; state.tex = null; state.viewDoc = null; state.app = app; state.err = null; state.applyOpen = false; state.headOpen = false; state.statusOpen = false;
  pruneDrafts(app);
  render(true);
}

async function refresh() { await loadList(); if (typeof state.sel === "number") state.app = await api("GET", `/api/applications/${state.sel}`); render(); }

// ---------- render ----------
let lastSig = "";
function render(force = false) {
  const main = $("#main");
  const scrollTop = main.scrollTop;
  renderSidebar(); bindSidebar();
  document.body.classList.toggle("detail", state.sel !== null);
  const back = `<button class="back ghost" id="backBtn">${icon("back")} Applications</button>`;
  const notice = (state.notice ? `<div class="notice ${state.celebrate ? "celebrate" : ""}"><span>${esc(state.notice)}</span>${state.noticeAction ? `<button id="noticeAct">${esc(state.noticeAction.label)}</button>` : ""}</div>` : "") + renderNeedsYou();
  let html;
  if (state.sel === "tasks") html = back + notice + renderTasks();
  else if (state.sel === "goals") html = back + notice + renderGoals();
  else if (state.sel === "feed") html = back + notice + renderFeed();
  else if (state.sel === "new") html = back + notice + renderNew();
  else if (state.sel === "settings") html = back + notice + renderSettings();
  else if (state.app) html = back + notice + renderDetail(state.app);
  else html = (state.sel === "home" ? back : "") + notice + renderHome();
  // Background polls call render() often; only touch the DOM when the output changed,
  // so scroll position and focus survive, and restore scroll when it did change.
  const sig = html.length + ":" + html.slice(0, 4000) + html.slice(-4000);
  if (force || sig !== lastSig) {
    lastSig = sig;
    // Remember the caret so a background re-render (a task finishing) doesn't kick you out of the field.
    const ae = document.activeElement;
    const keep = ae && main.contains(ae) && ["INPUT", "TEXTAREA"].includes(ae.tagName)
      ? { q: ae.dataset.draft ? `[data-draft="${CSS.escape(ae.dataset.draft)}"]` : ae.id ? `#${ae.id}` : null, s: ae.selectionStart, e: ae.selectionEnd } : null;
    main.innerHTML = html;
    hydrateDrafts(main);
    bind();
    main.scrollTop = scrollTop;
    if (keep?.q) { const el = $(keep.q, main); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.e); } catch {} } }
  }
  const pill = $("#busyPill");
  pill.hidden = !state.busy;
  if (state.busy) pill.innerHTML = `<span class="spinner"></span>${esc(state.busy)}`;
  if (window.innerWidth <= 768 && state.sel !== null) window.scrollTo(0, 0);
}

const NAV = [["home", "home", "Home"], ["feed", "feed", "Feed"], ["goals", "goals", "Goals"], ["tasks", "tasks", "Tasks"], ["settings", "settings", "Settings"]];
const isPhone = () => window.innerWidth <= 768;
function navHtml(mobile = false) {
  const hot = state.feedHot ?? 0, n = activeJobs().length, waiting = waitingJobs().length;
  // On a phone the list is its own screen ("Apps") and Home is the dashboard.
  const cur = mobile
    ? (state.sel === null || typeof state.sel === "number" || state.sel === "new" ? "apps" : state.sel)
    : (state.sel === null || state.sel === "home" || typeof state.sel === "number" || state.sel === "new" ? "home" : state.sel);
  const items = mobile ? [["apps", "apps", "Apps"], ...NAV] : NAV;
  return items.map(([k, icn, name]) => {
    const badge = k === "feed" && hot ? `<span class="badge ok">${hot}</span>` : k === "tasks" && (n || waiting) ? `<span class="badge ${waiting ? "warn" : ""}">${n}</span>` : "";
    return `<button data-nav="${k}" class="${cur === k ? "on" : ""}">${icon(icn)}<span>${name}</span>${badge}</button>`;
  }).join("");
}

function renderSidebar() {
  $("#nav").innerHTML = navHtml(); $("#bottomnav").innerHTML = navHtml(true);
  const counts = { all: state.apps.length };
  for (const a of state.apps) counts[a.status] = (counts[a.status] || 0) + 1;
  const due = state.apps.filter((a) => a.due).length;
  $("#filters").innerHTML = ["all", ...STATUSES].filter((s) => s === "all" || counts[s])
    .map((s) => `<button data-f="${s}" class="${s} ${state.filter === s ? "on" : ""}">${s} ${counts[s] || 0}</button>`).join("")
    + (due ? `<button data-f="due" class="due ${state.filter === "due" ? "on" : ""}">${icon("clock")} follow up ${due}</button>` : "");
  const q = state.search.trim().toLowerCase();
  let rows = state.apps.filter((a) => !state.pendingDeletes.has(a.id) && (state.filter === "all" || (state.filter === "due" ? a.due : a.status === state.filter)) && (!q || `${a.company} ${a.role} ${a.location || ""}`.toLowerCase().includes(q)));
  const by = { recent: (a, b) => b.updated_at.localeCompare(a.updated_at), fit: (a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0) || b.updated_at.localeCompare(a.updated_at), applied: (a, b) => (b.applied_at || "").localeCompare(a.applied_at || "") || b.updated_at.localeCompare(a.updated_at), company: (a, b) => a.company.localeCompare(b.company) };
  rows = [...rows].sort(by[state.sort] || by.recent);
  $("#sortSeg").innerHTML = [["recent", "Recent"], ["fit", "Fit"], ["applied", "Applied"], ["company", "A–Z"]].map(([k, n]) => `<button data-sort="${k}" class="${state.sort === k ? "on" : ""}">${n}</button>`).join("");
  $("#listCount").textContent = `${rows.length} of ${state.apps.length}`;
  $("#list").innerHTML = rows.length ? rows.map((a) => `
    <div class="row ${a.status} ${a.id === state.sel ? "sel" : ""}" data-id="${a.id}">
      <b>${esc(a.company)}${a.fit_score ? `<span class="pill fit f${a.fit_score}" title="Fit score">★ ${a.fit_score}</span>` : a.fit_status === "pending" ? `<span class="pill" title="Scoring fit…">★ …</span>` : ""}</b>
      <span>${esc(a.role)}</span>
      <div class="meta"><span class="pill ${a.status}">${a.status}</span>${a.location ? `<small>${esc(a.location)}</small>` : ""}${a.applied_at ? `<small>${a.applied_at}</small>` : ""}${a.due === "action" ? `<small class="due-txt">${icon("clock")} ${esc(a.next_action || "action due")}</small>` : a.due === "followup" ? `<small class="due-txt">${icon("clock")} ${a.days_since}d — follow up</small>` : ""}</div>
    </div>`).join("") : `<div class="empty" style="padding:40px 16px">${state.apps.length ? "No matches" : "No applications yet.<br><small>Press <kbd>n</kbd> or use + New.</small>"}</div>`;
  const s = state.settings;
  $("#llmFootText").textContent = s ? `${s.provider} · ${s.model}` : "";
  $("#logoutBtn").hidden = !s?.auth?.enabled;
  $("#goalWidget").innerHTML = goalWidget();
}

const PROVIDER_HELP = {
  anthropic: "Official Anthropic API. Best results — native PDF reading, guaranteed structured output, and a web-fetch fallback for scraper-blocked postings.",
  openrouter: "Hundreds of models behind one key. Model ids look like anthropic/claude-opus-5, openai/gpt-5, google/gemini-2.5-pro, meta-llama/llama-3.3-70b-instruct. Free-tier models are often unreliable at structured output.",
  ollama: "Local models, no key, nothing leaves your Mac. Needs Ollama running (ollama serve) and a pulled model (ollama pull llama3.1). Slower; small models give rougher drafts.",
};

function modelsFor(provider) { return state.modelCache[provider] || []; }

const SETTINGS_SECTIONS = [["model", "model", "Model"], ["tasks", "routes", "Per-task models"], ["guard", "guard", "Quality guard"], ["resumes", "resume", "Base resumes"], ["documents", "documents", "Documents"], ["prompts", "prompts", "Prompts"], ["extensions", "plug", "Extensions"], ["security", "security", "Security"]];
function renderSettings() {
  const s = state.settings;
  const models = modelsFor(s.provider);
  const local = s.provider === "ollama";
  const keyMask = s.keys[s.provider], keySrc = s.keySource[s.provider];
  const sec = SETTINGS_SECTIONS.some(([k]) => k === state.settingsSection) ? state.settingsSection : "model";
  // Status marks on the section list: things that need attention at a glance.
  const marks = {
    model: !local && !keyMask ? '<span class="dot-mark bad" title="No API key for this provider"></span>' : "",
    guard: state.guard?.unreliable.length ? `<span class="pill bad" title="Tasks routed to models that returned junk">${state.guard.unreliable.length}</span>` : "",
    security: !s.auth.enabled ? '<span class="dot-mark warn" title="No password set"></span>' : "",
    extensions: state.extensions?.errors.length ? `<span class="pill bad" title="Extension files that failed to load">${state.extensions.errors.length}</span>` : "",
  };
  const cards = {
    model: () => `<div class="card"><h2>Default model</h2>
      <div class="field"><label>Provider</label>
        <div class="seg">${s.providers.map((p) => `<button data-provider="${p}" class="${p === s.provider ? "on" : ""}">${p}</button>`).join("")}</div></div>
      <p class="muted">${PROVIDER_HELP[s.provider]}</p>

      ${local ? `
      <div class="field"><label>Ollama host</label>
        <div class="toolbar" style="margin:0"><input id="sHost" value="${esc(s.ollamaHost)}" placeholder="http://localhost:11434" style="flex:1"><button id="sHostSave">Save host</button></div></div>`
      : `
      <div class="field"><label>API key ${keyMask ? `<span style="color:var(--ok)"><span class="dot-mark ok"></span> ${esc(keyMask)}</span> <span class="muted">(${keySrc === "app" ? "saved in app" : "from .env"})</span>` : `<span style="color:var(--bad)"><span class="dot-mark bad"></span> none</span>`}</label>
        <div class="toolbar" style="margin:0">
          <input id="sKey" type="password" autocomplete="off" placeholder="${keyMask ? "Paste a new key to replace" : s.provider === "anthropic" ? "sk-ant-…" : "sk-or-…"}" style="flex:1">
          <button id="sKeySave" class="primary">Save key</button>
          ${keySrc === "app" ? `<button id="sKeyClear">Remove</button>` : ""}
        </div>
        <div class="muted" style="margin-top:4px">Stored locally in <code>data/tracker.db</code>. Takes effect immediately, no restart.</div></div>`}

      <div class="field"><label>Model <span class="muted">— current: <code>${esc(s.model)}</code></span></label>
        ${comboHtml("sModel", s.provider, models)}
        <div class="toolbar" style="margin-top:6px">
          <button id="sSave">Use typed model id</button>
          <button class="ghost" id="sLoad">${models.length ? `${icon("refresh")} Reload list (${models.length})` : "Load available models"}</button>
        </div></div>
    </div>`,
    security: () => `<div class="card"><h2>Security</h2>
      <p class="muted">${s.auth.enabled
        ? `Password required to open this app${s.auth.source === "env" ? " (set via <code>AUTH_PASSWORD</code> in .env)" : ""}. Sessions last 30 days per browser.`
        : "No password set — if this server is reachable on your network (see the phone URL printed at startup), anyone on it can open the app."}</p>
      <div class="field"><label>${s.auth.enabled ? "Change password" : "Set a password"}</label>
        <div class="toolbar" style="margin:0">
          <input id="sAuthPw" type="password" autocomplete="new-password" placeholder="At least 8 characters" style="flex:1">
          <button id="sAuthSave" class="primary">Save</button>
          ${s.auth.enabled && s.auth.source === "app" ? `<button id="sAuthClear">Remove password</button>` : ""}
        </div></div>
    </div>`,
    resumes: () => `<div class="card"><h2>Base resumes</h2>
      <p class="muted">One base is fine; two or three (e.g. “AI engineer” and “Platform / backend”) let the fit score pick the better one per posting and tailor from it. Files live in <code>profile/</code> as <code>resume.md</code> (default) and <code>resume-&lt;name&gt;.md</code>; drop a matching <code>resume-&lt;name&gt;.pdf</code> to import one.</p>
      ${(state.profile?.resumes || []).map((r) => `<div class="base-row" data-base-key="${esc(r.key)}">
        <div class="sp"><b>${esc(r.label)}</b>${r.candidate ? ` <span class="muted">— ${esc(r.candidate)}</span>` : ""} <span class="muted">· ${esc(r.file || r.source || "")}${r.hasMarkdown ? ` · ${r.words} words` : " · not imported yet"}${r.key === "default" ? " · default" : ""}</span></div>
        ${r.hasMarkdown ? `<button class="ghost" data-base-edit="${esc(r.key)}">${state.baseEdit?.key === r.key ? "Close" : "Edit"}</button>` : `<button class="primary" data-base-import="${esc(r.key)}">Import from ${esc(r.source)}</button>`}
        ${r.key !== "default" && r.hasMarkdown ? `<button class="ghost" data-base-del="${esc(r.key)}" title="Delete this base">×</button>` : ""}
      </div>${state.baseEdit?.key === r.key ? `<div style="margin:6px 0 12px"><textarea class="doc" id="baseText" style="min-height:320px">${esc(state.baseEdit.markdown)}</textarea><div class="toolbar" style="margin:6px 0 0"><button class="primary" id="baseSave">Save</button><span class="muted">Add <code>&lt;!-- label: Platform / backend --&gt;</code> as the first line to name it.</span></div></div>` : ""}`).join("")}
      <div class="toolbar" style="margin-top:10px"><input id="baseNew" placeholder="new base name, e.g. platform" style="width:220px"><span class="muted">copy of</span><div class="seg">${(state.profile?.resumes || []).filter((r) => r.hasMarkdown).map((r, i) => `<button data-base-from="${esc(r.key)}" class="${i === 0 ? "on" : ""}">${esc(r.label)}</button>`).join("")}</div><button id="baseCreate">Create</button></div>
    </div>`,
    documents: () => `<div class="card"><h2>PDF file names</h2>
      <p class="muted">What the recruiter sees in the upload. <code>{name}</code> comes from the heading of the base resume the application uses${s.candidate ? ` (currently <b>${esc(s.candidate)}</b>)` : " — none found yet"}; <code>{kind}</code> is <code>Resume</code> or <code>Cover-Letter</code> (added automatically if the pattern leaves it out, so the two files never collide); <code>{company}</code> is the employer. Spaces become hyphens.</p>
      <div class="toolbar" style="margin:0"><input id="sPdfName" value="${esc(s.pdfName || "")}" placeholder="${esc(s.pdfNameDefault)}" style="width:260px"><button id="sPdfNameSave" class="primary">Save</button><span class="muted">→ e.g. <code>${esc(s.pdfNameExample)}</code></span></div>
    </div>
    ${state.settings.latex !== false ? `<div class="card"><h2>PDF templates (LaTeX)</h2>
      <p class="muted">Global look of every generated PDF. Placeholders <code>{{NAME}}</code>, <code>{{CONTACT}}</code>, <code>{{BODY}}</code> (and <code>{{DATE}}</code> for letters) are filled from the Markdown. Spacing levers: <code>geometry</code> margins, <code>\\linespread</code>, <code>\\parskip</code>, <code>\\setlist</code> itemsep, <code>\\titlespacing</code>.</p>
      ${state.templates ? ["resume", "cover_letter"].map((k) => `<details class="prompt" data-template="${k}" ${state.templates[k].custom ? "open" : ""}>
        <summary>${k === "resume" ? "Resume template" : "Cover letter template"} ${state.templates[k].custom ? '<span class="pill warn">customised</span>' : ""}</summary>
        <textarea class="doc templateText" spellcheck="false" style="min-height:320px;margin-top:6px">${esc(state.templates[k].text)}</textarea>
        <div class="toolbar" style="margin:6px 0 0"><button class="primary" data-template-save="${k}">Save</button>${state.templates[k].custom ? `<button data-template-reset="${k}">Reset to default</button>` : ""}</div>
      </details>`).join("") : '<p class="muted">Loading…</p>'}
    </div>` : ""}
    <div class="card"><h2>Learned formatting preferences</h2>
      <p class="muted">Rules the app has learned from your manual edits (“Learn my format” on a resume or cover letter tab). Injected into every future generation as formatting guidance only — they never add or change facts. Edit freely; one rule per line.</p>
      ${state.style ? ["resume", "cover_letter"].map((k) => `<details class="prompt" data-style="${k}" ${state.style[k] ? "open" : ""}>
        <summary>${k === "resume" ? "Resume" : "Cover letter"} ${state.style[k] ? `<span class="pill accent">${state.style[k].split("\n").filter(Boolean).length} rules</span>` : '<span class="muted">none yet</span>'}</summary>
        <textarea class="styleText" style="min-height:120px;margin-top:6px" placeholder="- Keep every bullet to one line and start it with a verb\n- Put Education last\n- Dates as 'Mon YYYY – Mon YYYY'">${esc(state.style[k])}</textarea>
        <div class="toolbar" style="margin:6px 0 0"><button class="primary" data-style-save="${k}">Save</button>${state.style[k] ? `<button data-style-reset="${k}">Clear</button>` : ""}</div>
      </details>`).join("") : '<p class="muted">Loading…</p>'}
    </div>`,
    extensions: () => `<div class="card"><h2>Extensions</h2>
      <p class="muted">Connectors for boards the built-in sources don't cover. The bundled sources stick to official JSON endpoints; extensions are where anything else goes — an internal API, a site that needs HTML parsing, a private board. They run <b>in the server process</b> with the same access the app has, so only install ones you've read. Drop a <code>.ts</code> file into <code>${esc(state.extensions?.dir || "extensions")}/</code> and restart to install; see that folder's <code>README.md</code> for the contract and examples.</p>
      ${!state.extensions ? '<p class="muted"><span class="spinner"></span>Loading…</p>' : `
        ${state.extensions.extensions.length ? state.extensions.extensions.map((e) => `<div class="base-row" data-ext-id="${esc(e.id)}">
          <div class="sp"><b>${esc(e.label)}</b> ${e.enabled ? "" : '<span class="pill warn">paused</span>'} <span class="muted">· <code>${esc(e.id)}</code>${e.kind ? ` · ${e.kind === "board" ? `company board — add as <code>${esc(e.id)}:&lt;token&gt;</code>` : "aggregator — enable it in the feed settings"}` : ""}${e.capture ? " · handles capture" : ""} · <code>${esc(e.file)}</code></span></div>
          ${e.kind && e.enabled ? `<button class="ghost" data-ext-pull="${esc(e.id)}" title="Refresh the feed using only this extension">Pull now</button>` : ""}
          <button class="ghost" data-ext-toggle="${esc(e.id)}" data-ext-enable="${e.enabled ? "0" : "1"}">${e.enabled ? "Pause" : "Resume"}</button>
          <button class="ghost" data-ext-remove="${esc(e.id)}" title="Delete the file — irreversible">Remove</button>
        </div>`).join("") : '<p class="muted">None installed.</p>'}
        ${state.extensions.errors.length ? `<div class="banner" style="margin-top:10px">${icon("warn")} ${state.extensions.errors.length} file${state.extensions.errors.length === 1 ? "" : "s"} failed to load:${state.extensions.errors.map((x) => `<div style="margin-top:4px"><code>${esc(x.file)}</code> — ${esc(x.error)}</div>`).join("")}</div>` : ""}`}
    </div>`,
    prompts: () => `<div class="card"><h2>Prompts</h2>
      <p class="muted">Edit the instructions each task sends to the model. Your resume, notes, the job posting and previous answers are appended automatically — these are just the instruction parts. Blank = default.</p>
      ${state.prompts ? state.prompts.map((p) => `<details class="prompt" data-prompt="${p.key}" ${p.custom ? "open" : ""}>
        <summary>${esc(p.label)} ${p.custom ? '<span class="pill warn">customised</span>' : ""}</summary>
        <div class="muted" style="margin:6px 0">${esc(p.help)}</div>
        <textarea class="promptText" style="min-height:110px">${esc(p.current)}</textarea>
        <div class="toolbar" style="margin:6px 0 0"><button class="primary" data-prompt-save="${p.key}">Save</button>${p.custom ? `<button data-prompt-reset="${p.key}">Reset to default</button>` : ""}</div>
      </details>`).join("") : '<p class="muted">Loading…</p>'}
    </div>`,
    guard: () => `<div class="card"><h2>Model quality guard</h2>
      <p class="muted">Every structured result (captured job, fit score, answers…) is sanity-checked — placeholder values like <code>O-7</code>, leaked JSON, empty fields, repeated tokens. Junk is recorded against the model and the call is retried once on a stronger fallback.</p>
      ${state.guard ? `
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:13px;color:var(--ink)"><input type="checkbox" id="guardOn" ${state.guard.settings.enabled ? "checked" : ""} style="width:auto"> Enabled</label>
      <div class="field"><label>Fallback model ${state.guard.settings.provider && state.guard.settings.model ? "" : `<span class="muted">— auto: ${state.guard.auto ? `<code>${esc(state.guard.auto.provider)} · ${esc(state.guard.auto.model)}</code>` : "<b>none available</b> (add an Anthropic key or route a task to a strong model)"}</span>`}</label>
        <div class="toolbar" style="margin:0"><div class="seg">${["auto", ...s.providers].map((p) => `<button data-guard-provider="${p}" class="${(state.guard.settings.provider || "auto") === p ? "on" : ""}">${p}</button>`).join("")}</div>
        ${state.guard.settings.provider ? comboHtml("guardModel", state.guard.settings.provider, modelsFor(state.guard.settings.provider), state.guard.settings.model || "") : ""}</div></div>
      ${state.guard.unreliable.length ? `<div class="banner">${icon("warn")} Unreliable routing: ${state.guard.unreliable.map((u) => `<b>${esc(u.task)}</b> → ${esc(u.provider)} · ${esc(u.model)}`).join(", ")} — these models have returned junk in ≥30% of calls. Route them to something stronger below.</div>` : ""}
      ${state.guard.stats.length ? `<table class="stats"><tr><th>Model</th><th>OK</th><th>Junk</th><th>Rate</th><th>Last problem</th></tr>${state.guard.stats.map((m) => `<tr class="${m.junkRate >= 30 && m.total >= 3 ? "bad" : ""}"><td>${esc(m.id)}</td><td>${m.ok}</td><td>${m.junk}</td><td>${m.junkRate}%</td><td class="muted">${esc(m.lastProblem || "")}</td></tr>`).join("")}</table>
      <div class="toolbar" style="margin:8px 0 0"><button class="ghost" id="guardClear">Clear statistics</button></div>` : '<p class="muted">No calls recorded yet.</p>'}` : '<p class="muted">Loading…</p>'}
    </div>`,
    tasks: () => `<div class="card"><h2>Per-task models</h2>
      <p class="muted">Optional. Route individual tasks to a different provider/model — e.g. a free local model for capture, a strong hosted model for writing. Tasks left on “default” use the model above.</p>
      ${Object.entries(s.taskNames).map(([t, name]) => {
        const r = s.tasks[t];
        const prov = r?.provider ?? null;
        const bad = state.guard?.unreliable.some((u) => u.task === (r ? t : "default"));
        return `<div class="task-row" data-task="${t}">
          <div class="task-name">${esc(name)}${bad ? ' <span class="pill bad" title="This model has returned junk in ≥30% of calls">unreliable</span>' : ""}${r ? `<div class="muted"><code>${esc(r.provider)} · ${esc(r.model)}</code></div>` : `<div class="muted">default (${esc(s.provider)} · ${esc(s.model)})</div>`}</div>
          <div class="seg">${["default", ...s.providers].map((p) => `<button data-task-provider="${p}" class="${(p === "default" ? !r : prov === p) ? "on" : ""}">${p}</button>`).join("")}</div>
          ${r ? comboHtml(`task_${t}`, r.provider, modelsFor(r.provider), r.model) : ""}
        </div>`;
      }).join("")}
    </div>`,
  };
  return `${busy()}${errBox()}
    <div class="settings">
      <nav class="settings-nav">${SETTINGS_SECTIONS.map(([k, icn, n]) => `<button data-settings-section="${k}" class="${k === sec ? "on" : ""}">${icon(icn)}${n}${marks[k] || ""}</button>`).join("")}</nav>
      <div class="settings-body fade">${cards[sec]()}</div>
    </div>`;
}

function comboHtml(id, provider, models, current) {
  return `<div class="combo" data-combo="${id}" data-combo-provider="${provider}">
    <input id="${id}" autocomplete="off" spellcheck="false" placeholder="${models.length ? `Search ${models.length} models…` : "Type a model id…"}" value="${esc(current || "")}">
    <div class="combo-list" hidden></div>
  </div>`;
}

// Searchable model dropdown: filters the loaded list as you type; picking an
// item calls onPick(modelId). Enter picks the top match or the typed id.
function bindCombo(id, onPick) {
  const wrap = $(`[data-combo="${id}"]`); if (!wrap) return;
  const input = wrap.querySelector("input"), menu = wrap.querySelector(".combo-list"), provider = wrap.dataset.comboProvider;
  const items = () => modelsFor(provider);
  const show = () => {
    const q = input.value.trim().toLowerCase();
    const hits = items().filter((m) => !q || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)).slice(0, 200);
    menu.innerHTML = hits.length
      ? hits.map((m) => `<div class="combo-item" data-model="${esc(m.id)}"><b>${esc(m.id)}</b><small>${esc(m.label)}</small></div>`).join("")
      : `<div class="combo-item muted">${items().length ? "No matches" : "No list loaded yet — type a model id and press Enter."}</div>`;
    menu.hidden = false;
    menu.querySelectorAll("[data-model]").forEach((el) => el.onmousedown = (e) => { e.preventDefault(); menu.hidden = true; onPick(el.dataset.model); });
  };
  input.onfocus = show; input.oninput = show;
  input.onblur = () => setTimeout(() => (menu.hidden = true), 150);
  input.onkeydown = (e) => {
    if (e.key === "Escape") menu.hidden = true;
    if (e.key === "Enter") { e.preventDefault(); const first = menu.querySelector("[data-model]"); menu.hidden = true; if (first && input.value.trim()) onPick(first.dataset.model); else if (input.value.trim()) onPick(input.value.trim()); }
  };
  if (!items().length) loadModels(provider, true);
}

function renderHome() {
  const p = state.profile, st = state.settings, g = state.goals, f = state.feed;
  const hot = f?.counts?.hot ?? state.feedHot ?? 0;
  const due = state.apps.filter((a) => a.due);
  const steps = [
    { done: !!p?.hasMarkdown, name: "Import your base resume", hint: p?.hasSource ? `Found ${p.files.filter((x) => /\.(pdf|docx)$/i.test(x)).join(", ")} in profile/ — one click converts it to Markdown.` : "Drop resume.pdf or resume.docx into the profile/ folder, then reload.", action: p?.hasSource && !p?.hasMarkdown ? `<button class="primary" id="importBtn">Import</button>` : "" },
    { done: st && (st.provider === "ollama" || !!st.keys?.[st.provider]), name: "Connect a model", hint: st ? `${st.provider} · ${st.model}` : "", action: `<button data-nav="settings:model">Settings</button>` },
    { done: !!(f?.settings?.keywords?.length || state.feedKeywords), name: "Set up the job feed", hint: "Keywords, locations and a few company boards — new postings get scored for fit automatically.", action: `<button data-nav="feed">Feed</button>` },
    { done: state.apps.length > 0, name: "Capture your first posting", hint: "Paste a URL, the text, or use the bookmarklet from any job page.", action: `<button data-nav="new">+ New</button>` },
  ];
  const todo = steps.filter((x) => !x.done).length;
  return `${errBox()}
    ${todo && !state.checklistHidden ? `<div class="card"><div class="toolbar"><h3 style="margin:0">Get set up <span class="muted">· ${steps.length - todo}/${steps.length}</span></h3><div class="sp"></div><button class="ghost icon" id="hideChecklist" title="Hide">×</button></div>
      <div class="checklist">${steps.map((x) => `<div class="check ${x.done ? "done" : ""}"><span class="ic">${x.done ? "✓" : ""}</span><div class="sp"><b>${x.name}</b><small>${esc(x.hint)}</small></div>${x.done ? "" : x.action}</div>`).join("")}</div></div>` : ""}

    <div class="card">
      <div class="toolbar" style="margin-bottom:12px"><h2 style="margin:0">Today</h2><div class="sp"></div><button class="primary" id="dashNew">${icon("plus")} New application</button><button id="dashRefresh" ${f?.settings?.keywords?.length || state.feedKeywords ? "" : "disabled"} title="Refresh the job feed">${icon("refresh")} Feed</button></div>
      <div class="tiles">
        <div class="tile ${g?.periods.day.met ? "ok" : ""}" data-nav="goals"><b>${g ? `${g.periods.day.count}<span class="muted" style="font-size:14px">/${g.periods.day.goal || "–"}</span>` : "–"}</b><small>applied today${g?.streak ? ` — ${g.streak}-day streak` : ""}</small></div>
        <div class="tile ${due.length ? "warn" : ""}" data-filter="due"><b>${due.length}</b><small>follow-up${due.length === 1 ? "" : "s"} due</small></div>
        <div class="tile ${hot ? "ok" : ""}" data-nav="feed"><b>${hot}</b><small>hot in the feed</small></div>
        <div class="tile" data-nav="tasks"><b>${activeJobs().length}</b><small>task${activeJobs().length === 1 ? "" : "s"} running</small></div>
      </div>
    </div>

    ${due.length ? `<div class="card"><h3>Needs attention</h3>${due.slice(0, 6).map((a) => `<div class="act"><small>${a.due === "action" ? esc(a.next_action || "action due") : `${a.days_since}d quiet`}</small><a data-open-app="${a.id}"><b>${esc(a.company)}</b> — ${esc(a.role)}</a></div>`).join("")}</div>` : ""}

    <div class="card"><div class="toolbar"><h3 style="margin:0">Recent activity</h3></div>
      ${state.activity === null ? '<p class="muted"><span class="spinner"></span>Loading…</p>' : state.activity.length ? state.activity.map((e) => `<div class="act"><small>${fmtTime(e.created_at)}</small><span>${EV_ICON[e.kind] || ""}<a data-open-app="${e.application_id}"><b>${esc(e.company)}</b></a> — ${esc(e.kind.replace("_", " "))}${e.detail ? `: <span class="muted">${esc(e.detail.slice(0, 90))}</span>` : ""}</span></div>`).join("") : '<p class="muted">Nothing yet — capture a posting to get going.</p>'}
    </div>

    <details class="card" style="padding:14px 22px"><summary style="cursor:pointer;font-weight:600">From your browser — the bookmarklets</summary>
      <p style="margin-top:10px"><b>Save</b> — click it while viewing a job posting. It sends the page as <i>you</i> see it — logged in, fully rendered — so nothing gets blocked, and it clears human-verification hand-offs too.</p>
      <p><a id="bookmarklet" class="bm" href="#" draggable="true">${icon("pin")}Save to Job Tracker</a> <button id="bmCopy" style="margin-left:8px">Copy code</button> <span class="muted">(can't drag? copy, create a bookmark, paste as its URL)</span></p>
      <p style="margin-top:14px"><b>Fill</b> — click it on a company's application form. It works out which application the form belongs to from the page's address (or asks), then fills your name and contact details, attaches the resume and cover letter PDFs, and puts in answers you've already written. Questions it can't answer yet can be sent back here to draft; click Fill again once they're ready. It never presses submit.</p>
      <p><a id="fillBookmarklet" class="bm" href="#" draggable="true">${icon("pin")}Fill application form</a> <button id="fillCopy" style="margin-left:8px">Copy code</button>${state.settings?.auth?.enabled ? ` <span class="muted">Tied to your password — drag a fresh one if you change it.</span>` : ""}</p>
    </details>
    <details class="card" style="padding:14px 22px"><summary style="cursor:pointer;font-weight:600">Answer bank — search everything you've answered before</summary>
      <input id="bankQ" placeholder="Search previous answers…" style="margin-top:10px"><div id="bank"></div>
    </details>
    <details class="card" style="padding:14px 22px"><summary style="cursor:pointer;font-weight:600">Backup & export</summary>
      <div class="toolbar" style="margin:10px 0 0"><a href="/api/export/backup"><button class="primary">${icon("download")} Full backup (.tar.gz)</button></a><a href="/api/export/applications.csv"><button>${icon("download")} Applications (.csv)</button></a><span class="muted">Database, application folders, base resume, templates, secret key.</span></div>
    </details>`;
}

function renderNew() {
  const d = state.dup;
  const dupBox = d ? `<div class="banner dup"><div><b>Already tracked:</b> ${esc(d.existing.company)} · ${esc(d.existing.role)} <span class="pill ${esc(d.existing.status)}">${esc(d.existing.status)}</span> <span class="muted">${d.existing.applied_at ? `applied ${d.existing.applied_at}` : `captured ${esc(String(d.existing.created_at).slice(0, 10))}`}</span></div>
    <div class="toolbar" style="margin:0"><button class="primary" data-open-app="${d.existing.id}">Open it</button><button id="dupForce" title="Create a second application for the same posting anyway">${d.manual ? "Add anyway" : "Capture anyway"}</button><button class="ghost" id="dupDismiss">Dismiss</button></div></div>` : "";
  const manual = state.newMode === "manual";
  const modeSeg = `<div class="seg" style="margin-bottom:14px"><button data-new-mode="capture" class="${manual ? "" : "on"}">Capture a posting</button><button data-new-mode="manual" class="${manual ? "on" : ""}">Log by hand</button></div>`;
  if (manual) return `${busy()}${errBox()}${dupBox}
    <div class="card"><h2>New application</h2>${modeSeg}
      <p class="muted" style="margin-top:0">For things the tracker didn't see — an Easy Apply, a referral, something you applied to before. No model runs; add a posting URL or description later if you want documents generated.</p>
      <div class="grid2">
        <div class="field"><label>Company *</label><input id="mCompany" data-draft="new:0:mcompany" autofocus></div>
        <div class="field"><label>Role *</label><input id="mRole" data-draft="new:0:mrole"></div>
        <div class="field"><label>Location</label><input id="mLocation" data-draft="new:0:mlocation" placeholder="Singapore / Remote"></div>
        <div class="field"><label>Posting URL</label><input id="mUrl" data-draft="new:0:murl" placeholder="https://…"></div>
      </div>
      <div class="field"><label>Status</label><div class="seg status-seg" style="margin:0" id="mStatus">${STATUSES.map((st) => `<button data-mstatus="${st}" class="${st} ${st === (state.newStatus || "applied") ? "on" : ""}">${st}</button>`).join("")}</div></div>
      <div class="grid2">
        <div class="field"><label>Applied on</label><input type="date" id="mApplied" value="${localDate()}"></div>
        <div class="field"><label>Notes</label><input id="mNotes" data-draft="new:0:mnotes" placeholder="referral from …, recruiter name"></div>
      </div>
      <div class="toolbar" style="margin-top:4px"><button class="primary" id="manualBtn">Add application</button><button class="ghost" id="cancelNew">Cancel</button></div>
    </div>`;
  return `${busy()}${errBox()}${dupBox}
    <div class="card"><h2>New application</h2>${modeSeg}
      <div class="field"><label>Job posting URL</label><input id="nUrl" placeholder="https://…" autofocus data-draft="new:0:url"></div>
      <details ${hasDraft("new:0:desc") || hasDraft("new:0:company") || hasDraft("new:0:role") ? "open" : ""}><summary class="muted">Or paste the description (for pages that block scraping)</summary>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label>Company</label><input id="nCompany" data-draft="new:0:company"></div>
          <div class="field"><label>Role</label><input id="nRole" data-draft="new:0:role"></div>
        </div>
        <div class="field"><label>Description</label><textarea id="nDesc" style="min-height:200px" data-draft="new:0:desc"></textarea></div>
      </details>
      <div class="toolbar" style="margin-top:12px"><button class="primary" id="captureBtn">Capture</button><button class="ghost" id="cancelNew">Cancel</button><span class="muted">Runs in the background — you'll be taken to the application when it's ready.</span></div>
    </div>`;
}

function renderDetail(a) {
  const tabs = ["job", "resume", "cover_letter", "questions", "prep", "timeline"];
  const names = { job: "Job", resume: "Resume", cover_letter: "Cover letter", questions: "Questions", prep: "Prep", timeline: "Timeline" };
  const nDoc = (k) => a.documents.filter((d) => d.kind === k).length;
  const pen = (on) => on ? " ✎" : "";
  const badge = {
    job: (a.fit_score ? `★${a.fit_score}` : "") + pen(hasDraft(`job:${a.id}:`)),
    resume: (nDoc("resume") ? `v${nDoc("resume")}` : "") + pen(hasDraft(`doc:${a.id}:resume:`) || hasDraft(`tex:${a.id}:resume:`)),
    cover_letter: (nDoc("cover_letter") ? `v${nDoc("cover_letter")}` : "") + pen(hasDraft(`doc:${a.id}:cover_letter:`) || hasDraft(`tex:${a.id}:cover_letter:`)),
    questions: (a.questions.length || "") + pen(hasDraft(`q:${a.id}:`)), prep: nDoc("prep") ? "✓" : "", timeline: a.events.length || "",
  };
  return `${errBox()}
    <div class="card fade">
      <div class="toolbar head-row" style="margin:0">
        <div class="head-title"><h2>${esc(a.role)}</h2><div class="sub"><span>${esc(a.company)}</span>${a.location ? `<span>${esc(a.location)}</span>` : ""}${a.salary ? `<span>${esc(a.salary)}</span>` : ""}${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">posting ↗</a>` : ""}</div></div>
        <div class="sp"></div>
        <button id="delBtn" class="ghost icon" title="Delete application">${icon("trash")}</button>
      </div>
      ${(() => {
        const phone = isPhone(), due = !!a.next_action_at && a.next_action_at <= localDate() && !isClosed(a.status);
        // On a phone the seven status pills and the date controls are folded behind one line each.
        const statusRow = phone && !state.statusOpen
          ? `<button class="status-cur ${a.status}" id="statusOpen" title="Change status">${a.status} ▾</button>`
          : `<div class="seg status-seg" style="margin:0">${STATUSES.map((s, i) => `<button data-status="${s}" class="${s} ${s === a.status ? "on" : i < STATUSES.indexOf(a.status) && STATUSES.indexOf(a.status) < 5 ? "past" : ""}">${s}</button>`).join("")}</div>`;
        const summary = [a.applied_at ? `Applied ${a.applied_at}` : "Not applied yet", a.next_action_at ? `<span class="${due ? "due-txt" : ""}">${icon("clock")} ${esc(a.next_action || "next action")} ${a.next_action_at}${due ? " — due" : ""}</span>` : "", a.notes ? `${icon("note")} ${esc(a.notes.slice(0, 60))}${a.notes.length > 60 ? "…" : ""}` : ""].filter(Boolean).join(" · ");
        const meta = `<div class="head-meta">
          <label>Applied <input type="date" id="applied" value="${a.applied_at || ""}"></label>
          <label class="${due ? "due" : ""}">${due ? `${icon("clock")} Due` : "Next action"} <input type="date" id="nextAt" value="${a.next_action_at || ""}"><input id="nextTxt" placeholder="what, e.g. chase recruiter" value="${esc(a.next_action || "")}"></label>
          <span><button data-log="followup" title="Logs a follow-up today and clears the next action">✓ Followed up</button> <button data-log="call" class="ghost">${icon("phone")} Call</button> <button data-log="interview" class="ghost">${icon("users")} Interview</button></span>
          ${a.followed_up_at ? `<span class="muted">last follow-up ${a.followed_up_at}</span>` : ""}
        </div>
        <textarea id="notes" class="notes-line" placeholder="Notes…" rows="1" data-draft="notes:${a.id}:x">${esc(a.notes)}</textarea>`;
        return `<div class="toolbar" style="margin:8px 0 12px;gap:6px 12px">
        ${statusRow}
        <div class="sp"></div>
        <button id="applyBtn" class="${state.applyOpen ? "on" : a.status === "saved" ? "primary" : "ghost"}" title="Everything you need to submit this application in one place: PDFs, answers, the files folder, and marking it applied">${a.status === "saved" ? `${icon("send")} Apply` : `${icon("package")} Apply pack`}</button>
      </div>
      ${state.applyOpen ? renderApply(a) : ""}
      ${phone && !state.headOpen ? `<button class="head-summary" id="headOpen" title="Dates, follow-ups and notes">${summary} <span class="muted">· edit ▾</span></button>` : meta}`;
      })()}
    </div>
    <div class="tabs">${tabs.map((t) => `<button data-tab="${t}" class="${state.tab === t ? "on" : ""}">${names[t]}${badge[t] ? `<span class="tb">${badge[t]}</span>` : ""}</button>`).join("")}</div>
    ${jobBadge(a.id, { job: ["reextract", "fit"], resume: ["generate", "condense", "learn"], cover_letter: ["generate", "learn"], questions: ["questions"], prep: ["prep"], timeline: [] }[state.tab].concat(state.tab === "job" ? ["translate"] : []))}
    <div class="fade">${({ job: renderJob, resume: () => renderDoc(a, "resume"), cover_letter: () => renderDoc(a, "cover_letter"), questions: renderQuestions, prep: renderPrep, timeline: renderTimeline })[state.tab](a)}</div>`;
}

// The apply step: current PDFs, answers to paste, the folder for uploads, then mark as applied.
function renderApply(a) {
  const latest = (k) => a.documents.find((d) => d.kind === k);
  const count = (k) => a.documents.filter((d) => d.kind === k).length;
  const days = state.goals?.goals?.followupDays ?? 7; // 0 = nudges off → no follow-up prefilled
  const docRow = (kind, label) => {
    const doc = latest(kind);
    if (!doc) return `<div class="apply-row"><span class="ic bad">✗</span><div class="sp"><b>${label}</b> <span class="muted">not generated yet</span></div><button data-gen="${kind}">${icon("sparkle")} Generate</button></div>`;
    const pages = doc.pages && doc.pdf_current ? `${doc.pages} page${doc.pages > 1 ? "s" : ""}` : "";
    const warn = kind === "resume" && doc.pages > 1 && doc.pdf_current;
    return `<div class="apply-row"><span class="ic ${warn ? "warn" : "ok"}">${warn ? "!" : "✓"}</span><div class="sp"><b>${label}</b> <span class="muted">v${count(kind)}${pages ? ` · ${warn ? `<span style="color:var(--warn)">${pages}</span>` : pages}` : ""}${doc.edited ? " · edited by you" : ""}${doc.instructions ? ` · “${esc(doc.instructions.slice(0, 40))}${doc.instructions.length > 40 ? "…" : ""}”` : ""}${doc.file_name ? ` · <code title="File name the recruiter sees — change the pattern in Settings → Documents">${esc(doc.file_name)}</code>` : ""}</span></div>
      ${a.latex ? `<a href="/doc/${doc.id}.pdf" target="_blank"><button>${icon("download")} PDF</button></a>` : `<a href="/doc/${doc.id}" target="_blank"><button>Print / Save as PDF</button></a>`}</div>`;
  };
  const n = a.questions.length;
  return `<div class="apply fade" id="applyPanel">
    <div class="toolbar" style="margin:0 0 4px"><h3 style="margin:0">Apply to ${esc(a.company)}</h3><span class="muted">${a.status === "saved" ? "Get the pieces, submit on their site, then mark it applied." : `Marked applied${a.applied_at ? ` on ${a.applied_at}` : ""}.`}</span><div class="sp"></div><button class="ghost icon" id="applyClose" title="Close">×</button></div>
    ${docRow("resume", "Resume")}
    ${docRow("cover_letter", "Cover letter")}
    <div class="apply-row"><span class="ic ${n ? "ok" : ""}">${n ? "✓" : "–"}</span><div class="sp"><b>Answers</b> <span class="muted">${n ? `${n} ready to paste into the form` : "none drafted yet"}</span></div>${n ? `<button id="applyCopyAns" title="Copies every question and answer as plain text">${icon("copy")} Copy all answers</button>` : `<button class="ghost" data-tab="questions">Questions tab</button>`}</div>
    <div class="apply-row"><span class="ic">${icon("pin")}</span><div class="sp"><b>Autofill</b> <span class="muted">click the <b>Fill application form</b> bookmarklet (Home) on their form — details, PDFs and answers go in, and unanswered questions come back here to draft. This link is the same thing pinned to ${esc(a.company)}, for when the form's address doesn't match the posting.</span></div><a id="applyAutofill" class="bm" href="#" draggable="true">${icon("pin")}Fill this application</a></div>
    <div class="apply-row"><span class="ic">${icon("folder")}</span><div class="sp"><b>Files</b> <span class="muted">applications/${esc(a.folder)}/ — drag the PDFs from Finder into the upload fields</span></div><button id="applyReveal" title="Rebuilds the PDFs if needed and opens the folder in Finder">Show in Finder</button></div>
    ${a.status === "saved" ? `<div class="apply-done">
      <label>Applied on <input type="date" id="applyDate" value="${localDate()}"></label>
      <label>Follow up on <input type="date" id="applyNextAt" value="${days ? localDate(days) : ""}"><input id="applyNextTxt" value="${days ? "Follow up if no reply" : ""}" placeholder="next action"></label>
      <button class="primary" id="applyMark">✓ Mark as applied</button>
    </div>` : ""}
  </div>`;
}

function renderFit(a) {
  const f = a.fit;
  const dots = (n) => [1,2,3,4,5].map((i) => `<span class="dot ${i <= n ? "on f" + n : ""}"></span>`).join("");
  if (a.fit_status === "pending") return `<div class="card fit"><span class="spinner"></span>Scoring fit against your base resume…</div>`;
  if (a.fit_status === "error") return `<div class="card fit"><span class="err">Fit scoring failed: ${esc(f?.error || "unknown error")}</span> <button data-fit>Retry</button></div>`;
  if (!f) return `<div class="card fit"><div class="toolbar" style="margin:0"><span class="muted">${state.profile?.hasMarkdown ? "Not scored yet." : "Import your resume first, then score how well this role fits."}</span><div class="sp"></div><button data-fit ${state.profile?.hasMarkdown ? "" : "disabled"}>★ Score fit</button></div></div>`;
  const chips = (arr, cls) => arr.length ? arr.map((x) => `<span class="req ${cls}">${esc(x)}</span>`).join("") : '<span class="muted">none</span>';
  const bases = a.resumes || [];
  const baseRow = bases.length > 1 ? `<div class="toolbar" style="margin:0 0 8px;gap:6px"><span class="muted">Base resume:</span><div class="seg">${bases.map((b) => `<button data-base="${esc(b.key)}" class="${(a.resume_key || "default") === b.key ? "on" : ""}" title="${a.fit_all?.[b.key] ? `Fit ${a.fit_all[b.key].score}/5 with this base` : "Not scored with this base yet"}">${esc(b.label)}${a.fit_all?.[b.key] ? ` <span class="tb">★${a.fit_all[b.key].score}</span>` : ""}</button>`).join("")}</div>${a.resume_pinned ? '<span class="muted">pinned by you</span>' : '<span class="muted">best fit chosen automatically</span>'}</div>` : "";
  return `<div class="card fit">
    <div class="toolbar" style="margin:0 0 6px"><div class="dots">${dots(f.score)}</div><b style="font-size:16px">${f.score}/5</b><span>${esc(f.verdict)}</span><div class="sp"></div><button data-fit title="Re-score against every base resume">${icon("refresh")} Re-score</button></div>
    ${baseRow}
    <div class="fitgrid">
      <div><h4>Met</h4>${chips(f.met, "ok")}</div>
      <div><h4>Partial</h4>${chips(f.partial, "warn")}</div>
      <div><h4>Missing</h4>${chips(f.missing, "bad")}</div>
    </div>
    <p style="margin:10px 0 0"><b>Advice:</b> ${esc(f.advice)}</p>
  </div>`;
}

function renderJob(a) {
  const jk = `job:${a.id}:`;
  if (state.editJob) return `<div class="card">
    <div class="toolbar" style="margin:0 0 10px"><h3 style="margin:0">Edit job details</h3><span class="pill warn" data-dirty-for="${jk}" hidden>unsaved</span></div>
    <div class="grid2">
      <div class="field"><label>Company</label><input id="eCompany" value="${esc(a.company)}" data-draft="${jk}company"></div>
      <div class="field"><label>Role</label><input id="eRole" value="${esc(a.role)}" data-draft="${jk}role"></div>
      <div class="field"><label>Location</label><input id="eLocation" value="${esc(a.location || "")}" data-draft="${jk}location"></div>
      <div class="field"><label>Salary</label><input id="eSalary" value="${esc(a.salary || "")}" data-draft="${jk}salary"></div>
    </div>
    <div class="field"><label>Posting URL</label><input id="eUrl" value="${esc(a.url || "")}" data-draft="${jk}url"></div>
    <div class="field"><label>Key requirements (one per line)</label><textarea id="eReqs" style="min-height:120px" data-draft="${jk}reqs">${esc(a.requirements.join("\n"))}</textarea></div>
    <div class="field"><label>Description (Markdown)</label><textarea id="eDesc" class="doc" style="min-height:260px" data-draft="${jk}desc">${esc(a.description || "")}</textarea></div>
    <div class="toolbar"><button class="primary" id="eSave">Save</button><button id="eCancel" title="Leave the editor and throw away these edits">Cancel</button><span class="muted">Switching tabs keeps unsaved edits as a draft; Cancel discards them.</span></div>
  </div>`;
  return `${renderFit(a)}${hasDraft(jk) ? `<div class="banner draft"><span>✎ You have unsaved edits to the job details.</span><button data-edit-job>Continue editing</button><button class="ghost" data-discard="${jk}">Discard</button></div>` : ""}<div class="card">
    <div class="toolbar"><h3 style="margin:0">Key requirements</h3><div class="sp"></div>
      ${a.lang && a.lang !== "en" ? `<button data-translate class="primary" title="Translate the role, description and requirements to English (the original stays as source text)">${icon("globe")} Translate from ${esc(a.lang.toUpperCase())}</button>` : ""}
      <button data-reextract="description" title="${a.has_source_text ? "Re-run extraction on the original captured page text with the current capture model" : "Re-run extraction on the saved description with the current capture model"}">${icon("refresh")} Re-extract</button>
      ${a.url ? `<button data-reextract="url" title="Fetch the posting again and re-extract">${icon("refresh")} Fetch again</button>` : ""}
      <button data-edit-job>${icon("pen")} Edit</button></div>
    ${!a.requirements.length || !a.location ? `<div class="banner" style="margin:8px 0">Looks thin (${[!a.location && "no location", !a.salary && "no salary", !a.requirements.length && "no requirements"].filter(Boolean).join(", ")}). The page may have been a JavaScript shell — use the <b>Save to Job Tracker</b> bookmarklet from the home screen on the posting, or paste the description via ✎ Edit, then ↻ Re-extract.</div>` : ""}
    <div>${a.requirements.map((r) => `<span class="req">${esc(r)}</span>`).join("") || '<span class="muted">none extracted</span>'}</div>
    <h3 style="margin-top:16px">Description</h3><div class="preview desc">${mdToHtml(a.description || "")}</div>
  </div>`;
}

function renderDoc(a, kind) {
  const docs = a.documents.filter((d) => d.kind === kind);
  const latest = docs[0];
  const doc = (state.viewDoc && docs.find((d) => d.id === state.viewDoc)) || latest; // an older version can be viewed read-only
  const old = doc && doc !== latest;
  const vOf = (d) => docs.length - docs.indexOf(d);
  const label = kind === "resume" ? "resume" : "cover letter";
  const mode = old && !["preview", "pdf", "diff"].includes(state.docMode) ? "preview" : state.docMode;
  const fit = doc && kind === "resume" ? (doc.size.words <= a.one_page.words && doc.size.lines <= a.one_page.lines) : null;
  const overflow = doc && kind === "resume" && (doc.pages && doc.pdf_current ? doc.pages > 1 : !fit);
  const pageInfo = doc && doc.pages && doc.pdf_current
    ? (kind === "resume" ? (doc.pages === 1 ? ' · <span style="color:var(--ok)">1 page (PDF)</span>' : ` · <span style="color:var(--warn)">${doc.pages} pages (PDF)</span>`) : ` · ${doc.pages} page${doc.pages > 1 ? "s" : ""} (PDF)`)
    : kind === "resume" ? (fit ? ' · <span style="color:var(--ok)">likely one page</span>' : ' · <span style="color:var(--warn)">may run past one page</span>') : "";
  const sizeInfo = doc ? `<span class="muted" title="One-page budget: ≤${a.one_page.words} words, ≤${a.one_page.lines} lines">${doc.size.words} words · ${doc.size.lines} lines${pageInfo}${doc.custom_tex ? ' <span class="pill warn">custom LaTeX</span>' : ""}${doc.edited ? ' <span class="pill accent">edited by you</span>' : ""}${doc.instructions ? ` <span class="pill" title="What you asked for when this version was drafted">✎ ${esc(doc.instructions.length > 48 ? doc.instructions.slice(0, 45) + "…" : doc.instructions)}</span>` : ""}</span>` : "";
  // Unsaved edits live in state.drafts until saved or discarded (see hydrateDrafts).
  const mdKey = doc ? `doc:${a.id}:${kind}:${doc.id}` : "", texKey = doc ? `tex:${a.id}:${kind}:${doc.id}` : "";
  const parked = doc && mode !== "edit" && hasDraft(mdKey) ? `<div class="banner draft"><span>✎ You have unsaved edits to this ${label}.</span><button data-docmode="edit">Continue editing</button><button class="ghost" data-discard="${mdKey}">Discard</button></div>` : "";
  const parkedTex = doc && mode !== "tex" && hasDraft(texKey) ? `<div class="banner draft"><span>✎ You have unsaved LaTeX edits to this ${label}.</span><button data-docmode="tex">Continue editing</button><button class="ghost" data-discard="${texKey}">Discard</button></div>` : "";
  // Edits made to an earlier version (typed while a regenerate was running) are kept, not dropped.
  const older = (what, cur) => draftKeys(`${what}:${a.id}:${kind}:`).filter((k) => k !== cur).map((k) => { const id = Number(k.split(":")[3]), v = docs.findIndex((d) => d.id === id); return { k, v: v >= 0 ? docs.length - v : null }; });
  const stale = [...older("doc", mdKey).map((o) => ({ ...o, what: "Markdown", into: mdKey })), ...older("tex", texKey).map((o) => ({ ...o, what: "LaTeX", into: texKey }))];
  const staleBox = doc ? stale.map((o) => `<div class="banner draft"><span>✎ Unsaved ${o.what} edits to ${o.v ? `v${o.v}` : "an earlier version"} of this ${label} were kept.</span><button data-restore="${o.k}" data-restore-into="${o.into}" title="Put that text into the editor for the current version (v${docs.length}) — it replaces the current text until you save">Restore into editor</button><button class="ghost" data-discard="${o.k}">Discard</button></div>`).join("") : "";
  let body = "";
  if (doc) {
    if (mode === "edit") body = `${doc.custom_tex ? `<div class="banner">This version has hand-edited LaTeX. Saving Markdown edits regenerates the LaTeX from the Markdown (your TeX tweaks will be dropped).</div>` : ""}<textarea class="doc" id="docText" data-draft="${mdKey}">${esc(doc.content)}</textarea>`;
    else if (mode === "tex") body = state.tex && state.tex.id === doc.id
      ? `<div class="muted" style="margin-bottom:6px">Full document — edit anything. To fit one page, the usual levers are near the top: <code>geometry</code> margins, <code>\\linespread</code>, <code>\\parskip</code>, the <code>itemsep</code>/<code>topsep</code> in <code>\\setlist</code>, <code>\\titlespacing</code>, and the <code>[10.5pt]</code> in <code>\\documentclass</code>. Global changes belong in Settings → Documents → PDF templates.</div>
         <textarea class="doc" id="texText" spellcheck="false" style="min-height:480px" data-draft="${texKey}">${esc(state.tex.tex)}</textarea>
         <div class="toolbar" style="margin-top:8px"><button class="primary" id="texSave">Save & rebuild PDF</button>${state.tex.custom ? `<button id="texReset">Reset to generated</button>` : ""}<button class="ghost" data-discard="${texKey}" data-dirty-for="${texKey}" hidden>Discard edits</button><span class="pill warn" data-dirty-for="${texKey}" hidden>unsaved</span><div class="sp"></div><span class="muted" id="texResult"></span></div>`
      : `<p class="muted"><span class="spinner"></span>Loading LaTeX…</p>`;
    else if (mode === "pdf") {
      // The real compiled page, fetched as a blob so build errors can be shown instead of a broken frame.
      const key = `${doc.id}:${doc.hash}`, cur = state.pdf;
      if (!cur || cur.key !== key) { loadPdf(a, doc, key); body = `<p class="muted"><span class="spinner"></span>${doc.pdf_current ? "Loading the PDF…" : "Compiling the PDF…"}</p>`; }
      else if (cur.error) body = `<div class="errbar"><span>✗ The PDF didn't build: ${esc(cur.error)}</span></div><p class="muted">Fix it in LaTeX mode (or the Markdown), then come back here.</p>`;
      else body = `<iframe class="pdf-frame" src="${cur.url}#toolbar=0&navpanes=0&view=FitH" title="${label} PDF"></iframe>`;
    }
    else if (mode === "diff") {
      const options = [...(kind === "resume" ? [["base", "Base resume (profile/resume.md)"]] : []), ...docs.slice(1).map((d, i) => [String(d.id), `v${docs.length - 1 - i} · ${fmtTime(d.created_at)}`])];
      const sel = options.some(([v]) => v === state.diffAgainst) ? state.diffAgainst : options[0]?.[0];
      const other = sel === "base" ? state.baseResume : docs.find((d) => String(d.id) === sel)?.content;
      body = `<div class="toolbar"><span class="muted">Compare this version with</span><div class="seg wrap">${options.map(([v, n]) => `<button data-diff="${v}" class="${sel === v ? "on" : ""}">${esc(n)}</button>`).join("") || '<span class="muted">nothing yet — only one version</span>'}</div></div>
        ${other == null ? (sel === "base" ? '<p class="muted"><span class="spinner"></span>Loading base resume…</p>' : "") : `<div class="diff-legend muted"><span class="d-add">added</span> <span class="d-del">removed</span> — a quick way to spot anything the model invented or dropped.</div><div class="diff">${renderDiff(other, doc.content)}</div>`}`;
    }
    else body = `<div class="preview ${kind}">${mdToHtml(doc.content)}</div>`;
  } else body = `<p class="muted">No ${label} yet. Generation uses <code>profile/resume.md</code> + this job's description${kind === "resume" ? ", and is constrained to one page" : ""}.</p>`;
  const modes = [["preview", "Preview"], ...(a.latex ? [["pdf", "PDF"]] : []), ...(old ? [] : [["edit", "Edit"], ...(a.latex ? [["tex", "LaTeX"]] : [])]), ["diff", "Compare"]];
  const versions = docs.length > 1 ? `<details class="versions"><summary title="Every version is kept — view an earlier one or bring it back as the newest">v${vOf(doc)} of ${docs.length} ▾</summary><div class="versions-list">${docs.map((d) => `<div class="version-row ${d === doc ? "cur" : ""}"><b>v${vOf(d)}</b><span class="muted">${fmtTime(d.created_at)} · ${d.size.words} words${d.edited ? " · edited" : ""}${d.instructions ? ` · ✎ ${esc(d.instructions.slice(0, 40))}${d.instructions.length > 40 ? "…" : ""}` : ""}</span><div class="sp"></div>${d === doc ? '<span class="pill accent">viewing</span>' : `<button class="ghost" data-view-doc="${d.id}">View</button>`}</div>`).join("")}</div></details>` : `<span class="v">v${docs.length}</span>`;
  const oldBox = old ? `<div class="banner draft"><span>Viewing <b>v${vOf(doc)}</b> of ${docs.length} (${fmtTime(doc.created_at)}). Editing happens on the latest version.</span><button class="primary" id="docRestore" data-doc="${doc.id}" title="Copies this text into a new version v${docs.length + 1}; nothing is overwritten">↩ Restore as v${docs.length + 1}</button><button class="ghost" id="docLatest">Back to latest</button></div>` : "";
  const ats = kind === "resume" ? renderAts(a, doc) : "";
  // Free-text steering for the next draft; prefilled with what produced the current version.
  const noteKey = `${a.id}:${kind}`, note = state.genNote[noteKey] ?? doc?.instructions ?? "";
  return `<div class="card">
    <div class="doc-actions">
      <div class="doc-group gen"><span>Generate</span><div>
        <button class="${doc ? "" : "primary"}" data-gen="${kind}">${icon("sparkle")} ${doc ? "Regenerate" : "Generate"} ${label}</button>
        ${kind === "resume" ? `<button data-gen="both" title="Resume first, then a cover letter based on it">Resume + cover letter</button>` : ""}
      </div>
      <input id="genNote" class="gen-note" value="${esc(note)}" placeholder="Instructions for the next draft — e.g. shorter · lead with the Monta work · mention my visa status" title="Optional. Steers the next draft (and the cover letter when generating both); kept with the version it produces. Enter to generate."></div>
      ${doc && !old ? `<div class="doc-group"><span>Refine</span><div>
        ${kind === "resume" ? `<button data-condense="${doc.id}" class="${overflow ? "primary" : ""}" title="Ask the model to cut this version down to one page (saves as a new version)">${icon("scissors")} Condense</button>` : ""}
        <button data-learn="${doc.id}" ${doc.edited ? "" : "disabled"} title="${doc.edited ? "Compare your edits with the generated version and update the formatting rules for future " + label + "s (content is ignored)" : "Edit and save the Markdown first, then the app can learn your formatting preferences"}">${icon("cap")} Learn my format</button>
      </div></div>` : ""}
      ${doc ? `<div class="doc-right">
      <div class="doc-group"><span>View</span><div><div class="seg">${modes.map(([m, n]) => `<button data-docmode="${m}" class="${mode === m ? "on" : ""}">${n}</button>`).join("")}</div></div></div>
      <div class="doc-group"><span>Export</span><div>
        ${a.latex ? `<a href="/doc/${doc.id}.pdf" target="_blank"><button class="primary">${icon("download")} PDF</button></a><a href="/doc/${doc.id}" target="_blank"><button class="ghost" title="Browser print fallback">Print</button></a>` : `<a href="/doc/${doc.id}" target="_blank"><button class="primary">Print / Save as PDF</button></a>`}
        <button data-copy-text="${doc.id}" title="Copy as plain text — for application forms that want the ${label} pasted in">${icon("copy")} Copy text</button>
      </div></div>
      </div>` : ""}
    </div>
    ${oldBox}${parked}${parkedTex}${staleBox}
    ${ats}
    ${doc ? `<div class="doc-meta">${versions}<span>${fmtTime(doc.created_at)}</span><span>·</span>${sizeInfo}<div class="sp" style="flex:1"></div>${mode === "edit" ? `<span class="pill warn" data-dirty-for="${mdKey}" hidden>unsaved</span><button class="ghost" data-discard="${mdKey}" data-dirty-for="${mdKey}" hidden>Discard</button><button id="saveDoc" class="primary" data-doc="${doc.id}">Save edits</button>` : ""}</div>` : ""}
    ${body}
  </div>`;
}

// Deterministic ATS keyword check — no model, recomputed on demand from the posting.
function renderAts(a, doc) {
  const r = state.ats;
  const stale = !r || r.appId !== a.id || r.docId !== (doc?.id ?? "base");
  if (stale) { loadAts(a, doc); }
  const rep = stale ? null : r;
  const bar = (pct, cls) => `<div class="ats-bar"><div class="${cls}" style="width:${pct}%"></div></div>`;
  return `<details class="ats" ${state.atsOpen ? "open" : ""} id="atsBox">
    <summary><span>${icon("search")} ATS keyword check${rep ? ` — <b>${rep.requiredCoverage}%</b> of required terms, ${rep.coverage}% overall` : ""}</span><span class="muted">${rep ? `${rep.label} · ${rep.words} words` : "checking…"}</span></summary>
    ${rep ? `
      <div class="ats-grid">
        <div><div class="muted">Required terms <b>${rep.matched.filter((t) => t.required).length}/${rep.matched.filter((t) => t.required).length + rep.missing.filter((t) => t.required).length}</b></div>${bar(rep.requiredCoverage, rep.requiredCoverage >= 80 ? "ok" : rep.requiredCoverage >= 50 ? "warn" : "bad")}</div>
        <div><div class="muted">All terms <b>${rep.matched.length}/${rep.matched.length + rep.missing.length}</b></div>${bar(rep.coverage, rep.coverage >= 70 ? "ok" : rep.coverage >= 40 ? "warn" : "bad")}</div>
      </div>
      ${rep.missing.length ? `<div class="ats-row"><span class="muted">Missing</span><div>${rep.missing.map((t) => `<span class="req bad" title="${t.required ? "From the requirements" : "Mentioned in the description"}">${esc(t.term)}${t.required ? "" : '<small> ·</small>'}</span>`).join("")}</div></div>` : ""}
      <div class="ats-row"><span class="muted">Found</span><div>${rep.matched.map((t) => `<span class="req ok" title="${t.aliasHit ? `matched via “${t.aliasHit}”` : ""}${t.required ? " · required" : ""}">${esc(t.term)} <small>×${t.count}</small></span>`).join("") || '<span class="muted">none</span>'}</div></div>
      ${rep.overused.length ? `<div class="ats-row"><span class="muted">Overused</span><div class="muted">${esc(rep.overused.join(", "))} — reads as keyword stuffing.</div></div>` : ""}
      <div class="toolbar" style="margin:8px 0 0">
        ${rep.missing.some((t) => t.required) ? `<button data-emphasize="${esc(JSON.stringify(rep.missing.filter((t) => t.required).map((t) => t.term)))}" title="Regenerate the resume asking the model to use these exact terms where truthful">✨ Regenerate with the missing required terms</button>` : ""}
        ${doc ? `<button class="ghost" data-ats-base>Compare base resume instead</button>` : ""}
        <span class="muted">Deterministic — no model involved. Terms come from the extracted requirements (required) and technical terms in the description (·). Aliases like Postgres/PostgreSQL and k8s/Kubernetes count.</span>
      </div>` : ""}
  </details>`;
}
const dropPdf = () => { if (state.pdf?.url) URL.revokeObjectURL(state.pdf.url); state.pdf = null; };
async function loadPdf(a, doc, key) {
  if (loadPdf.inflight === key) return;
  loadPdf.inflight = key;
  try {
    const res = await fetch(`/doc/${doc.id}.pdf`, { cache: "no-store" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || res.statusText); }
    const blob = await res.blob();
    if (state.app?.id !== a.id) return; // navigated away while compiling — nothing to show, nothing to keep
    dropPdf();
    state.pdf = { key, url: URL.createObjectURL(blob) };
    if (!doc.pdf_current && state.app?.id === a.id) state.app = await api("GET", `/api/applications/${a.id}`); // page count is known now
  } catch (e) { dropPdf(); state.pdf = { key, error: e.message }; }
  finally { loadPdf.inflight = null; }
  if (state.app?.id === a.id && state.docMode === "pdf") render(true);
}
async function loadAts(a, doc) {
  const docId = doc?.id ?? "base";
  if (loadAts.inflight === `${a.id}:${docId}`) return;
  loadAts.inflight = `${a.id}:${docId}`;
  try { const r = await api("GET", `/api/applications/${a.id}/ats?doc=${doc ? doc.id : "base"}`); state.ats = { ...r, appId: a.id, docId }; if (state.app?.id === a.id) render(true); }
  catch (e) { state.ats = { appId: a.id, docId, error: e.message, matched: [], missing: [], overused: [], coverage: 0, requiredCoverage: 0, words: 0, label: "?" }; }
  finally { loadAts.inflight = null; }
}

function renderQuestions(a) {
  const found = a.events.find((e) => e.kind === "questions_found");
  return `<div class="card">
    <h3>Paste application questions (one per line)</h3>
    <textarea id="qIn" data-draft="qin:${a.id}:x" placeholder="Why do you want to work at ${esc(a.company)}?\nDescribe a project you're proud of.">${found && !a.questions.length ? esc(found.detail) : ""}</textarea>
    <div class="toolbar" style="margin-top:8px"><button class="primary" id="answerBtn">Draft answers</button><span class="muted">Reuses your answers from other applications where they fit.</span><div class="sp"></div>${a.questions.length > 1 ? `<button id="copyAllAns" title="Every question and answer as plain text">${icon("copy")} Copy all answers</button>` : ""}</div>
  </div>
  ${a.questions.map((q) => `<div class="qa" data-q="${q.id}">
    <h4>${esc(q.question)}</h4>
    <textarea class="ans" data-draft="q:${a.id}:${q.id}">${esc(q.answer)}</textarea>
    <div class="toolbar" style="margin:8px 0 0"><button data-copy="${q.id}">Copy</button><button data-saveq="${q.id}" data-dirty-primary="q:${a.id}:${q.id}">Save</button><span class="pill warn" data-dirty-for="q:${a.id}:${q.id}" hidden>unsaved</span><div class="sp"></div><button data-delq="${q.id}">Remove</button></div>
    <div class="toolbar" style="margin:6px 0 0;flex-wrap:wrap"><span class="muted">Rewrite:</span><button class="ghost" data-revise="${q.id}" data-revise-instr="Shorten it, keeping the key point.">Shorten</button><button class="ghost" data-revise="${q.id}" data-revise-instr="Expand it with more concrete detail and examples.">Expand</button><input class="reviseIn" id="reviseIn${q.id}" placeholder="or describe how, e.g. “more specific”" style="flex:1;min-width:160px"><button data-revise="${q.id}" data-revise-input="reviseIn${q.id}">Revise</button></div>
  </div>`).join("")}`;
}

function renderPrep(a) {
  const doc = a.documents.find((d) => d.kind === "prep");
  return `<div class="card">
    <div class="toolbar"><button class="${doc ? "" : "primary"}" id="prepBtn">${doc ? `${icon("refresh")} Regenerate prep sheet` : `${icon("cap")} Prepare me for the interview`}</button><div class="sp"></div>${doc ? `<span class="muted">${fmtTime(doc.created_at)}</span>` : ""}</div>
    ${doc ? `<div class="preview">${mdToHtml(doc.content)}</div>` : `<p class="muted">A prep sheet for <b>this</b> role: how to pitch yourself, likely questions with talking points from your own experience, how to handle the gaps the fit score found, stories to have ready, and questions to ask them.${a.fit ? "" : " Score the fit first for better gap coverage."}</p>`}
  </div>`;
}

const EV_ICON = { translated: icon("globe"), created: icon("sparkle"), status: icon("arrow"), generated: icon("resume"), questions: icon("prompts"), questions_found: icon("question"), fit: "★ ", edited: icon("pen"), reextracted: icon("refresh"), learned: icon("cap"), note: icon("note"), followup: icon("check"), call: icon("phone"), interview: icon("users") };
function renderTimeline(a) {
  return `<div class="card">
    <div class="toolbar"><input id="noteTxt" placeholder="Log a note — recruiter name, what they said, salary mentioned…" style="flex:1"><button id="noteAdd">Add note</button></div>
    ${a.events.map((e) => `<div class="ev"><small>${fmtTime(e.created_at)}</small><b>${EV_ICON[e.kind] || ""} ${esc(e.kind.replace("_", " "))}</b><span style="flex:1;white-space:pre-wrap">${esc(e.detail)}</span>${["note", "followup", "interview", "call"].includes(e.kind) ? `<button class="ghost icon" data-ev-del="${e.id}" title="Remove">×</button>` : ""}</div>`).join("") || '<span class="muted">No events</span>'}</div>
    <p class="muted">Files: <code>applications/${esc(a.folder)}/</code></p>`;
}

const busy = () => ""; // shown as a floating pill instead (see render)
const errBox = () => state.err ? `<div class="errbar"><span>✗ ${esc(state.err)}</span><div class="sp"></div><button class="ghost icon" id="errClose" title="Dismiss">×</button></div>` : "";

// Switch main view. Views that load data do so lazily and re-render when it lands.
function go(view) {
  state.app = null; state.err = null; state.dup = null; dropPdf();
  if (view.startsWith("settings:")) { state.settingsSection = view.slice(9); view = "settings"; }
  if (view === "apps") { state.sel = null; render(true); return; }
  if (view === "home") { state.sel = isPhone() ? "home" : null; state.activity = null; api("GET", "/api/activity").then((a) => { state.activity = a; render(); }).catch(() => { state.activity = []; render(); }); }
  else state.sel = view;
  render(true);
  if (view === "settings") loadModels(state.settings.provider, true);
  if (view === "feed") loadFeed().then(() => render(true));
  if (view === "goals") loadGoals().then(() => render(true));
  if (view === "new") $("#nUrl")?.focus();
}

// ---------- events ----------
function bindList() {
  document.querySelectorAll("#list .row").forEach((r) => r.onclick = () => open(Number(r.dataset.id)));
  document.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { state.filter = b.dataset.f; render(true); });
  document.querySelectorAll("#sortSeg [data-sort]").forEach((b) => b.onclick = () => { state.sort = b.dataset.sort; renderSidebar(); bindSidebar(); });
}
// Sidebar + bottom nav are re-rendered on every poll, so their handlers are re-attached each time.
function bindSidebar() {
  bindList();
  document.querySelectorAll("#nav [data-nav], #bottomnav [data-nav]").forEach((b) => b.onclick = () => go(b.dataset.nav));
  $("#goalMini") && ($("#goalMini").onclick = () => go("goals"));
}
// Bound once: static controls outside the re-rendered regions.
function bindStatic() {
  const sb = $("#search");
  sb.oninput = () => { state.search = sb.value; renderSidebar(); bindSidebar(); };
  $("#newBtn").onclick = () => go("new");
  $("#helpBtn").onclick = () => { $("#helpOverlay").hidden = false; };
  $("#helpClose").onclick = () => { $("#helpOverlay").hidden = true; };
  $("#helpOverlay").onclick = (e) => { if (e.target === $("#helpOverlay")) $("#helpOverlay").hidden = true; };
  $("#themeBtn").onclick = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch {}
  };
  $("#logoutBtn").onclick = () => run(null, async () => { await api("POST", "/api/logout"); location.href = "/"; });
  $("#palQ").oninput = () => { pal.q = $("#palQ").value; pal.idx = 0; renderPal(); };
  $("#palette").onclick = (e) => { if (e.target === $("#palette")) palClose(); };
}
function bind() {
  document.querySelectorAll("#main [data-nav]").forEach((b) => b.onclick = () => go(b.dataset.nav));
  document.querySelectorAll("[data-filter]").forEach((b) => b.onclick = () => { state.filter = b.dataset.filter; state.sel = null; state.app = null; render(true); });
  $("#errClose") && ($("#errClose").onclick = () => { state.err = null; render(true); });
  $("#noticeAct") && ($("#noticeAct").onclick = () => state.noticeAction?.fn());
  $("#hideChecklist") && ($("#hideChecklist").onclick = () => { state.checklistHidden = true; try { localStorage.setItem("checklistHidden", "1"); } catch {} render(true); });
  $("#dashNew") && ($("#dashNew").onclick = () => go("new"));
  $("#dashRefresh") && ($("#dashRefresh").onclick = () => enqueue("/api/feed/refresh", {}));
  $("#notes") && ($("#notes").oninput = (e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; });
  $("#backBtn") && ($("#backBtn").onclick = () => go(isPhone() ? "apps" : "home"));
  document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; state.editJob = false; state.docMode = "preview"; state.tex = null; state.viewDoc = null; state.err = null; render(); });

  if (state.sel === "settings") {
    document.querySelectorAll("[data-settings-section]").forEach((b) => b.onclick = () => { state.settingsSection = b.dataset.settingsSection; try { localStorage.setItem("settingsSection", state.settingsSection); } catch {} state.err = null; render(true); $("#main").scrollTop = 0; });
    const saveDefault = (body, label) => run(label, async () => { state.settings = await api("PUT", "/api/settings", body); });
    document.querySelectorAll("[data-provider]").forEach((b) => b.onclick = () => saveDefault({ provider: b.dataset.provider }, `Switching to ${b.dataset.provider}…`));
    $("#sSave") && ($("#sSave").onclick = () => { const model = $("#sModel").value.trim(); if (!model) { state.err = "Type a model id first."; render(); return; } saveDefault({ model }, "Saving…"); });
    $("#sLoad") && ($("#sLoad").onclick = () => run("Fetching model list…", () => loadModels(state.settings.provider, false)));
    $("#sPdfNameSave") && ($("#sPdfNameSave").onclick = () => saveDefault({ pdfName: $("#sPdfName").value }, "Saving…"));
    $("#sPdfName") && ($("#sPdfName").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#sPdfNameSave").click(); } });
    $("#sKeySave") && ($("#sKeySave").onclick = () => { const apiKey = $("#sKey").value.trim(); if (!apiKey) { state.err = "Paste a key first."; render(); return; } run("Saving key…", async () => { state.settings = await api("PUT", "/api/settings", { apiKey }); delete state.modelCache[state.settings.provider]; await loadModels(state.settings.provider, true); }); });
    $("#sKeyClear") && ($("#sKeyClear").onclick = () => run("Removing key…", async () => { state.settings = await api("PUT", "/api/settings", { clearKey: true }); delete state.modelCache[state.settings.provider]; }));
    $("#sHostSave") && ($("#sHostSave").onclick = () => { const ollamaHost = $("#sHost").value; run("Saving host…", async () => { state.settings = await api("PUT", "/api/settings", { ollamaHost }); delete state.modelCache.ollama; await loadModels("ollama", true); }); });
    bindCombo("sModel", (model) => saveDefault({ model }, "Saving…"));
    $("#sAuthSave") && ($("#sAuthSave").onclick = () => {
      const password = $("#sAuthPw").value;
      if (password.length < 8) { state.err = "Password must be at least 8 characters."; render(); return; }
      run("Saving password…", async () => { state.settings.auth = await api("PUT", "/api/settings/auth", { password }); });
    });
    $("#sAuthClear") && ($("#sAuthClear").onclick = () => run("Removing password…", async () => { state.settings.auth = await api("PUT", "/api/settings/auth", { clear: true }); }));

    document.querySelectorAll("[data-base-import]").forEach((b) => b.onclick = () => enqueue("/api/profile/import", { key: b.dataset.baseImport }));
    document.querySelectorAll("[data-base-edit]").forEach((b) => b.onclick = () => run(null, async () => {
      if (state.baseEdit?.key === b.dataset.baseEdit) { state.baseEdit = null; return; }
      const r = await api("GET", `/api/profile/resume?key=${encodeURIComponent(b.dataset.baseEdit)}`); state.baseEdit = { key: r.key, markdown: r.markdown };
    }));
    $("#baseSave") && ($("#baseSave").onclick = () => { const markdown = $("#baseText").value, key = state.baseEdit.key; run("Saving base resume…", async () => { await api("PUT", `/api/profile/resumes/${encodeURIComponent(key)}`, { markdown }); state.baseEdit = null; state.profile = await api("GET", "/api/profile"); }); });
    document.querySelectorAll("[data-base-del]").forEach((b) => b.onclick = () => { if (!confirm(`Delete the “${b.dataset.baseDel}” base resume?`)) return; run("Deleting…", async () => { await api("DELETE", `/api/profile/resumes/${encodeURIComponent(b.dataset.baseDel)}`); state.profile = await api("GET", "/api/profile"); }); });
    document.querySelectorAll("[data-base-from]").forEach((b) => b.onclick = () => { document.querySelectorAll("[data-base-from]").forEach((x) => x.classList.remove("on")); b.classList.add("on"); });
    $("#baseCreate") && ($("#baseCreate").onclick = () => {
      const key = $("#baseNew").value.trim(), copyFrom = $("[data-base-from].on")?.dataset.baseFrom || "default";
      if (!key) { state.err = "Give the new base a short name, e.g. platform."; render(true); return; }
      run("Creating base…", async () => { const r = await api("PUT", `/api/profile/resumes/${encodeURIComponent(key)}`, { copyFrom, label: key.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }); state.profile = await api("GET", "/api/profile"); const md = await api("GET", `/api/profile/resume?key=${encodeURIComponent(r.key)}`); state.baseEdit = { key: r.key, markdown: md.markdown }; });
    });
    if (!state.guard) api("GET", "/api/guard").then((g) => { state.guard = g; if (state.sel === "settings") render(true); });
    if (!state.extensions) api("GET", "/api/extensions").then((x) => { state.extensions = x; if (state.sel === "settings") render(true); }).catch(() => { state.extensions = { dir: "extensions", extensions: [], errors: [] }; });
    document.querySelectorAll("[data-ext-toggle]").forEach((b) => b.onclick = () => run(null, async () => { state.extensions = await api("POST", `/api/extensions/${encodeURIComponent(b.dataset.extToggle)}/enabled`, { enabled: b.dataset.extEnable === "1" }); }));
    document.querySelectorAll("[data-ext-remove]").forEach((b) => b.onclick = () => {
      if (!confirm(`Remove this extension? This deletes its file from ${state.extensions?.dir || "extensions"}/ — you'd need to reinstall it to bring it back.`)) return;
      run("Removing extension…", async () => { state.extensions = await api("DELETE", `/api/extensions/${encodeURIComponent(b.dataset.extRemove)}`); });
    });
    document.querySelectorAll("[data-ext-pull]").forEach((b) => b.onclick = () => enqueue(`/api/extensions/${encodeURIComponent(b.dataset.extPull)}/pull`, {}));
    if (state.guard) {
      $("#guardOn") && ($("#guardOn").onchange = () => run(null, async () => { const r = await api("PUT", "/api/guard", { enabled: $("#guardOn").checked }); state.guard = { ...state.guard, ...r }; }));
      document.querySelectorAll("[data-guard-provider]").forEach((b) => b.onclick = () => run(null, async () => {
        const p = b.dataset.guardProvider;
        const r = await api("PUT", "/api/guard", p === "auto" ? { provider: null, model: null } : { provider: p, model: state.guard.settings.provider === p ? state.guard.settings.model : "" });
        state.guard = { ...state.guard, ...r };
      }));
      if (state.guard.settings.provider) bindCombo("guardModel", (model) => run("Saving…", async () => { const r = await api("PUT", "/api/guard", { model }); state.guard = { ...state.guard, ...r }; }));
      $("#guardClear") && ($("#guardClear").onclick = () => run(null, async () => { await api("DELETE", "/api/guard/stats"); state.guard = await api("GET", "/api/guard"); }));
    }
    if (!state.prompts) api("GET", "/api/prompts").then((p) => { state.prompts = p; if (state.sel === "settings") render(); });
    if (!state.style) api("GET", "/api/style").then((t) => { state.style = t; if (state.sel === "settings") render(); });
    document.querySelectorAll("[data-style-save]").forEach((b) => b.onclick = () => { const k = b.dataset.styleSave, text = $(`[data-style="${k}"] .styleText`).value; run("Saving…", async () => { state.style = await api("PUT", `/api/style/${k}`, { text }); }); });
    document.querySelectorAll("[data-style-reset]").forEach((b) => b.onclick = () => run("Clearing…", async () => { state.style = await api("PUT", `/api/style/${b.dataset.styleReset}`, { reset: true }); }));
    if (!state.templates) api("GET", "/api/templates").then((t) => { state.templates = t; if (state.sel === "settings") render(); });
    document.querySelectorAll("[data-template-save]").forEach((b) => b.onclick = () => { const k = b.dataset.templateSave, text = $(`[data-template="${k}"] .templateText`).value; run("Saving template…", async () => { await api("PUT", `/api/templates/${k}`, { text }); state.templates = await api("GET", "/api/templates"); }); });
    document.querySelectorAll("[data-template-reset]").forEach((b) => b.onclick = () => run("Resetting…", async () => { await api("PUT", `/api/templates/${b.dataset.templateReset}`, { reset: true }); state.templates = await api("GET", "/api/templates"); }));
    document.querySelectorAll("[data-prompt-save]").forEach((b) => b.onclick = () => {
      const key = b.dataset.promptSave, text = $(`[data-prompt="${key}"] .promptText`).value;
      run("Saving prompt…", async () => { state.prompts = await api("PUT", `/api/prompts/${key}`, { text }); });
    });
    document.querySelectorAll("[data-prompt-reset]").forEach((b) => b.onclick = () => run("Resetting…", async () => { state.prompts = await api("PUT", `/api/prompts/${b.dataset.promptReset}`, { reset: true }); }));

    document.querySelectorAll(".task-row").forEach((row) => {
      const task = row.dataset.task;
      const saveTask = (body) => run("Saving…", async () => { state.settings = await api("PUT", `/api/settings/tasks/${task}`, body); });
      row.querySelectorAll("[data-task-provider]").forEach((b) => b.onclick = () => {
        const p = b.dataset.taskProvider;
        if (p === "default") saveTask({ reset: true });
        else saveTask({ provider: p, model: state.settings.tasks[task]?.provider === p ? state.settings.tasks[task].model : (p === state.settings.provider ? state.settings.model : "") });
      });
      const r = state.settings.tasks[task];
      if (r) bindCombo(`task_${task}`, (model) => saveTask({ provider: r.provider, model }));
    });
  }

  $("#importBtn") && ($("#importBtn").onclick = () => enqueue("/api/profile/import", { key: "default" }));
  document.querySelectorAll("[data-open-app]").forEach((b) => b.onclick = () => open(Number(b.dataset.openApp)));
  if (state.sel === "feed") {
    document.querySelectorAll("[data-feed-filter]").forEach((b) => b.onclick = () => { state.feedFilter = b.dataset.feedFilter; loadFeed().then(() => render(true)); });
    $("#feedSearch") && ($("#feedSearch").oninput = () => { state.feedFacets.q = $("#feedSearch").value; render(true); });
    $("#feedLocFilter") && ($("#feedLocFilter").oninput = () => { state.feedFacets.loc = $("#feedLocFilter").value; render(true); });
    $("#feedRemoteOnly") && ($("#feedRemoteOnly").onchange = () => { state.feedFacets.remoteOnly = $("#feedRemoteOnly").checked; render(true); });
    document.querySelectorAll("[data-feed-src]").forEach((b) => b.onclick = () => {
      const v = b.dataset.feedSrc, s = state.feedFacets.sources;
      state.feedFacets.sources = s.includes(v) ? s.filter((x) => x !== v) : [...s, v];
      render(true);
    });
    document.querySelectorAll("[data-feed-lvl]").forEach((b) => b.onclick = () => {
      const v = b.dataset.feedLvl, s = state.feedFacets.levels;
      state.feedFacets.levels = s.includes(v) ? s.filter((x) => x !== v) : [...s, v];
      render(true);
    });
    $("#feedFacetClear") && ($("#feedFacetClear").onclick = () => { state.feedFacets = { q: "", loc: "", sources: [], levels: [], remoteOnly: false }; render(true); });
    $("#feedRefresh") && ($("#feedRefresh").onclick = () => enqueue("/api/feed/refresh", {}));
    $("#feedScore") && ($("#feedScore").onclick = () => enqueue("/api/feed/score", {}));
    document.querySelectorAll("[data-feed-score1]").forEach((b) => b.onclick = () => enqueue("/api/feed/score", { ids: [Number(b.dataset.feedScore1)] }));
    document.querySelectorAll("[data-feed-track]").forEach((b) => b.onclick = () => enqueue(`/api/feed/${b.dataset.feedTrack}/track`, {}));
    document.querySelectorAll("[data-feed-dismiss]").forEach((b) => b.onclick = () => {
      const id = Number(b.dataset.feedDismiss), it = state.feed?.items.find((x) => x.id === id);
      run(null, async () => {
        await api("POST", `/api/feed/${id}/dismiss`); await loadFeed();
        notify(`Removed ${it ? `${it.title_en || it.title} at ${it.company}` : "posting"}`, { label: "Undo", fn: () => run(null, async () => { await api("POST", `/api/feed/${id}/restore`); await loadFeed(); state.notice = null; state.noticeAction = null; }) }, 6000);
      });
    });
    document.querySelectorAll("[data-feed-delete]").forEach((b) => b.onclick = () => run(null, async () => { await api("POST", `/api/feed/${b.dataset.feedDelete}/delete`); await loadFeed(); }));
    document.querySelectorAll("[data-feed-restore]").forEach((b) => b.onclick = () => run(null, async () => { await api("POST", `/api/feed/${b.dataset.feedRestore}/restore`); await loadFeed(); }));
    $("#feedPurge") && ($("#feedPurge").onclick = () => run(null, async () => { await api("DELETE", "/api/feed/dismissed"); await loadFeed(); }));
    $("#fDiscoverBtn") && ($("#fDiscoverBtn").onclick = () => { const input = $("#fDiscover").value; run("Looking for a job board…", async () => { state.feedTest = await api("POST", "/api/feed/discover", { input }); }); });
    $("#fDiscover") && ($("#fDiscover").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#fDiscoverBtn").click(); } });
    document.querySelectorAll("[data-add-board]").forEach((b) => b.onclick = () => { const ta = $("#fBoards"); if (!ta.value.split("\n").includes(b.dataset.addBoard)) ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + b.dataset.addBoard; state.feedTest = null; $("#fSave").click(); });
    document.querySelectorAll("[data-matchin]").forEach((b) => b.onclick = () => { document.querySelectorAll("[data-matchin]").forEach((x) => x.classList.remove("on")); b.classList.add("on"); });
    document.querySelectorAll("[data-agg]").forEach((c) => c.onchange = () => { if (c.dataset.agg === "adzuna") { state.feed.settings.aggregators.adzuna = c.checked; render(true); } });
    document.querySelectorAll("[data-bulk]").forEach((b) => b.onclick = () => run("Working…", async () => { const r = await api("POST", "/api/feed/bulk", { action: b.dataset.bulk }); notify(`${b.dataset.bulk === "track_hot" ? `Queued ${r.n} capture${r.n === 1 ? "" : "s"}${r.linked ? `, linked ${r.linked} already tracked` : ""}` : `Dismissed ${r.n}`}`); await loadFeed(); await refreshJobs(); }));
    $("#fSave") && ($("#fSave").onclick = () => {
      const body = { keywords: $("#fKeywords").value, matchIn: $("[data-matchin].on")?.dataset.matchin || "title", locations: $("#fLocations").value, exclude: $("#fExclude").value, boards: $("#fBoards").value,
        aggregators: Object.fromEntries([...document.querySelectorAll("[data-agg]")].map((c) => [c.dataset.agg, c.checked])),
        levels: [...document.querySelectorAll("[data-level]")].filter((c) => c.checked).map((c) => c.dataset.level),
        autoTranslate: $("#fTranslate").checked,
        adzuna: { appId: $("#fAdzId")?.value ?? undefined, appKey: $("#fAdzKey")?.value ?? undefined },
        minScore: $("#fMin").value, minAts: $("#fMinAts").value, scorePerRefresh: $("#fCap").value, maxAgeDays: $("#fAge").value, autoHours: $("#fAuto").value };
      if (body.adzuna.appId === undefined) delete body.adzuna;
      run("Saving feed settings…", async () => {
        const r = await api("PUT", "/api/feed/settings", body);
        await loadFeed();
        const parts = [r.hidden ? `${r.hidden} posting${r.hidden === 1 ? "" : "s"} hidden by the new filters` : "", r.restored ? `${r.restored} back` : ""].filter(Boolean);
        notify(`✓ Feed settings saved${parts.length ? " — " + parts.join(", ") : ""}`);
      });
    });
  }
  $("#gSave") && ($("#gSave").onclick = () => {
    const body = { daily: $("#gDaily").value, weekly: $("#gWeekly").value, monthly: $("#gMonthly").value, weekends: $("#gWeekends").checked, followupDays: $("#gFollow").value };
    run("Saving targets…", async () => { state.goals = await api("PUT", "/api/goals", body); await loadList(); });
  });
  $("#clearJobs") && ($("#clearJobs").onclick = async () => { await api("DELETE", "/api/jobs"); await refreshJobs(); render(); });
  document.querySelectorAll("[data-job-cancel]").forEach((b) => b.onclick = async () => { await api("POST", `/api/jobs/${b.dataset.jobCancel}/cancel`); await refreshJobs(); render(); });
  document.querySelectorAll("[data-job-retry]").forEach((b) => b.onclick = async () => { await api("POST", `/api/jobs/${b.dataset.jobRetry}/retry`); await refreshJobs(); render(); });
  document.querySelectorAll("[data-resume]").forEach((b) => b.onclick = () => run("Trying again…", async () => { await api("POST", `/api/jobs/${b.dataset.resume}/resume`, {}); state.pasteFor = null; await refreshJobs(); }));
  document.querySelectorAll("[data-paste]").forEach((b) => b.onclick = () => { state.pasteFor = state.pasteFor === Number(b.dataset.paste) ? null : Number(b.dataset.paste); render(); $("#pasteText")?.focus(); });
  document.querySelectorAll("[data-paste-save]").forEach((b) => b.onclick = () => {
    const text = $("#pasteText").value;
    if (text.trim().length < 200) { state.err = "That looks too short — paste the whole posting page."; render(); return; }
    run("Reading the page you pasted…", async () => { await api("POST", `/api/jobs/${b.dataset.pasteSave}/resume`, { text }); state.pasteFor = null; await refreshJobs(); });
  });
  document.querySelectorAll("[data-job-open]").forEach((b) => b.onclick = () => open(Number(b.dataset.jobOpen)));
  $("#bookmarklet") && api("GET", "/api/bookmarklet").then(({ href }) => {
    const a = $("#bookmarklet"); if (!a) return;
    a.href = href; a.onclick = (e) => { e.preventDefault(); alert("Drag this link to your bookmarks bar, then click it while on a job posting."); };
    $("#bmCopy").onclick = () => copyText(href).then((ok) => { $("#bmCopy").textContent = ok ? "Copied" : "Blocked"; setTimeout(() => ($("#bmCopy").textContent = "Copy code"), 1200); });
  });
  $("#fillBookmarklet") && api("GET", "/api/autofill/bookmarklet").then(({ href }) => {
    const a = $("#fillBookmarklet"); if (!a) return;
    a.href = href; a.onclick = (e) => { e.preventDefault(); alert("Drag this link to your bookmarks bar, then click it while on a company's application form."); };
    $("#fillCopy").onclick = () => copyText(href).then((ok) => { $("#fillCopy").textContent = ok ? "Copied" : "Blocked"; setTimeout(() => ($("#fillCopy").textContent = "Copy code"), 1200); });
  });
  $("#bankQ") && ($("#bankQ").oninput = debounce(async () => {
    const rows = await api("GET", `/api/qa-bank?q=${encodeURIComponent($("#bankQ").value)}`);
    $("#bank").innerHTML = rows.map((q) => `<div class="qa"><h4>${esc(q.question)}</h4><div class="muted" style="margin-bottom:6px">${esc(q.company)} · ${esc(q.role)}</div><div style="white-space:pre-wrap">${esc(q.answer)}</div></div>`).join("") || '<p class="muted">Nothing yet.</p>';
  }, 250));

  $("#cancelNew") && ($("#cancelNew").onclick = () => { clearDrafts("new:"); state.dup = null; state.sel = null; render(true); });
  document.querySelectorAll("[data-new-mode]").forEach((b) => b.onclick = () => { state.newMode = b.dataset.newMode; state.dup = null; render(true); });
  document.querySelectorAll("[data-mstatus]").forEach((b) => b.onclick = () => { state.newStatus = b.dataset.mstatus; render(true); });
  $("#manualBtn") && ($("#manualBtn").onclick = () => {
    const body = { company: $("#mCompany").value.trim(), role: $("#mRole").value.trim(), location: $("#mLocation").value.trim(), url: $("#mUrl").value.trim(), status: state.newStatus || "applied", applied_at: $("#mApplied").value, notes: $("#mNotes").value.trim(), force: !!state.dup };
    if (!body.company || !body.role) { state.err = "Company and role are required."; render(true); return; }
    state.dup = null;
    run("Adding…", async () => {
      try { const app = await api("POST", "/api/applications/manual", body); clearDrafts("new:"); await loadList(); await loadGoals(); state.newStatus = null; await open(app.id); }
      catch (e) { if (e.data?.existing) { state.dup = { existing: e.data.existing, manual: true }; } else throw e; }
    });
  });
  $("#dupDismiss") && ($("#dupDismiss").onclick = () => { state.dup = null; render(true); });
  $("#dupForce") && ($("#dupForce").onclick = () => { const d = state.dup; if (d.manual) { $("#manualBtn").click(); return; } state.dup = null; enqueue(d.url, { ...d.body, force: true }).then(() => { if (!state.err) { clearDrafts("new:"); render(true); } }); });
  $("#captureBtn") && ($("#captureBtn").onclick = () => {
    const body = { url: $("#nUrl").value.trim(), company: $("#nCompany").value.trim(), role: $("#nRole").value.trim(), description: $("#nDesc").value.trim() };
    if (!body.url && !body.description) { state.err = "Paste a job posting URL, or open the section below and paste the description."; render(); return; }
    enqueue("/api/applications", body).then(() => { if (!state.err && !state.dup) { clearDrafts("new:"); for (const id of ["#nUrl", "#nCompany", "#nRole", "#nDesc"]) $(id) && ($(id).value = ""); render(true); } });
  });

  const a = state.app;
  if (!a) return;
  const patch = (body) => run(null, async () => {
    state.app = await api("PATCH", `/api/applications/${a.id}`, body);
    await loadList();
    if ("status" in body || "applied_at" in body) { await loadGoals(); celebrate(state.app.celebrate); }
  });
  document.querySelectorAll("[data-status]").forEach((b) => b.onclick = () => { state.statusOpen = false; patch({ status: b.dataset.status }); });
  $("#applied") && ($("#applied").onchange = (e) => patch({ applied_at: e.target.value || null }));
  $("#notes") && ($("#notes").onchange = (e) => patch({ notes: e.target.value }));
  $("#nextAt") && ($("#nextAt").onchange = (e) => patch({ next_action_at: e.target.value || null }));
  $("#nextTxt") && ($("#nextTxt").onchange = (e) => patch({ next_action: e.target.value.trim() || null }));
  document.querySelectorAll("[data-log]").forEach((b) => b.onclick = () => run(null, async () => { state.app = await api("POST", `/api/applications/${a.id}/events`, { kind: b.dataset.log }); await loadList(); }));
  $("#noteAdd") && ($("#noteAdd").onclick = () => { const detail = $("#noteTxt").value.trim(); if (!detail) return; run(null, async () => { state.app = await api("POST", `/api/applications/${a.id}/events`, { kind: "note", detail }); }); });
  $("#noteTxt") && ($("#noteTxt").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#noteAdd").click(); } });
  document.querySelectorAll("[data-ev-del]").forEach((b) => b.onclick = () => run(null, async () => { state.app = await api("DELETE", `/api/events/${b.dataset.evDel}`); }));
  $("#prepBtn") && ($("#prepBtn").onclick = () => enqueue(`/api/applications/${a.id}/prep`, {}));
  document.querySelectorAll("[data-edit-job]").forEach((b) => b.onclick = () => { state.editJob = true; render(); });
  document.querySelectorAll("[data-discard]").forEach((b) => b.onclick = () => { clearDrafts(b.dataset.discard); render(true); });
  document.querySelectorAll("[data-restore]").forEach((b) => b.onclick = () => {
    const from = b.dataset.restore, into = b.dataset.restoreInto;
    state.drafts[into] = state.drafts[from]; delete state.drafts[from]; persistDrafts();
    state.docMode = into.startsWith("tex:") ? "tex" : "edit";
    render(true);
    if (state.docMode === "tex") $(`[data-docmode="tex"]`)?.click(); // loads the TeX; the draft is applied on top
  });
  document.querySelectorAll("[data-fit]").forEach((b) => b.onclick = () => enqueue(`/api/applications/${a.id}/fit`, {}));
  document.querySelectorAll("[data-base]").forEach((b) => b.onclick = () => run("Switching base resume…", async () => { state.app = await api("PATCH", `/api/applications/${a.id}`, { resume_key: b.dataset.base }); state.ats = null; await loadList(); }));
  document.querySelectorAll("[data-reextract]").forEach((b) => b.onclick = () => enqueue(`/api/applications/${a.id}/reextract`, { source: b.dataset.reextract }));
  $("[data-translate]") && ($("[data-translate]").onclick = () => enqueue(`/api/applications/${a.id}/translate`, {}));
  $("#eCancel") && ($("#eCancel").onclick = () => { clearDrafts(`job:${a.id}:`); state.editJob = false; render(true); });
  $("#eSave") && ($("#eSave").onclick = () => {
    const body = {
      company: $("#eCompany").value.trim(), role: $("#eRole").value.trim(), location: $("#eLocation").value.trim() || null,
      salary: $("#eSalary").value.trim() || null, url: $("#eUrl").value.trim() || null, description: $("#eDesc").value,
      requirements: $("#eReqs").value.split("\n").map((r) => r.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean),
    };
    if (!body.company || !body.role) { state.err = "Company and role are required."; render(); return; }
    run("Saving…", async () => { state.app = await api("PATCH", `/api/applications/${a.id}`, body); clearDrafts(`job:${a.id}:`); state.editJob = false; await loadList(); });
  });
  $("#delBtn").onclick = () => undoable({
    text: `Deleted ${a.company} · ${a.role} (files on disk are kept)`,
    apply: () => { state.pendingDeletes.add(a.id); state.sel = null; state.app = null; dropPdf(); render(true); },
    commit: async () => { await api("DELETE", `/api/applications/${a.id}`); state.pendingDeletes.delete(a.id); for (const k of Object.keys(state.drafts)) if (k.split(":")[1] === String(a.id)) delete state.drafts[k]; persistDrafts(); await loadList(); await loadGoals(); render(true); },
    revert: () => { state.pendingDeletes.delete(a.id); open(a.id); },
  });

  const genNote = () => ($("#genNote")?.value ?? state.genNote[`${a.id}:${state.tab}`] ?? "").trim();
  document.querySelectorAll("[data-gen]").forEach((b) => b.onclick = () => enqueue(`/api/applications/${a.id}/generate`, { what: b.dataset.gen, instructions: genNote() }));
  $("#genNote") && ($("#genNote").oninput = (e) => { state.genNote[`${a.id}:${state.tab}`] = e.target.value; });
  $("#genNote") && ($("#genNote").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $(".doc-group.gen [data-gen]")?.click(); } });
  document.querySelectorAll("[data-diff]").forEach((b) => b.onclick = () => { state.diffAgainst = b.dataset.diff; render(); });
  document.querySelectorAll("[data-view-doc]").forEach((b) => b.onclick = () => { state.viewDoc = Number(b.dataset.viewDoc); state.docMode = "preview"; state.tex = null; render(true); });
  $("#docLatest") && ($("#docLatest").onclick = () => { state.viewDoc = null; render(true); });
  $("#docRestore") && ($("#docRestore").onclick = () => run("Restoring…", async () => { const r = await api("POST", `/api/documents/${$("#docRestore").dataset.doc}/restore`, {}); state.viewDoc = null; state.docMode = "preview"; state.app = r; state.ats = null; if (r.pdfError) state.err = `Restored, but the PDF failed to build: ${r.pdfError}`; else notify("✓ Restored as the newest version"); }));
  document.querySelectorAll("[data-docmode]").forEach((b) => b.onclick = () => {
    state.docMode = b.dataset.docmode; render();
    if (state.docMode === "diff" && state.baseResume == null) api("GET", `/api/profile/resume?key=${encodeURIComponent(a.resume_key || "default")}`).then((r) => { state.baseResume = r.markdown; if (state.docMode === "diff") render(); }).catch(() => { state.baseResume = ""; });
    if (state.docMode === "tex") {
      const doc = a.documents.find((d) => d.kind === state.tab);
      if (doc && state.tex?.id !== doc.id) api("GET", `/api/documents/${doc.id}/tex`).then((t) => { state.tex = { id: doc.id, ...t }; if (state.docMode === "tex") render(); });
    }
  });
  $("#texSave") && ($("#texSave").onclick = () => { const tex = $("#texText").value, id = state.tex.id; run("Compiling LaTeX…", async () => {
    const r = await api("PUT", `/api/documents/${id}/tex`, { tex });
    clearDrafts(`tex:${a.id}:${state.tab}:${id}`);
    state.tex = { id, tex, custom: true };
    state.app = await api("GET", `/api/applications/${a.id}`);
    if (!r.ok) state.err = r.error; else state.err = null;
  }); });
  $("#texReset") && ($("#texReset").onclick = () => run("Regenerating LaTeX from Markdown…", async () => { await api("PUT", `/api/documents/${state.tex.id}/tex`, { reset: true }); clearDrafts(`tex:${a.id}:${state.tab}:${state.tex.id}`); state.tex = null; state.app = await api("GET", `/api/applications/${a.id}`); const doc = state.app.documents.find((d) => d.kind === state.tab); const t = await api("GET", `/api/documents/${doc.id}/tex`); state.tex = { id: doc.id, ...t }; }));
  document.querySelectorAll("[data-condense]").forEach((b) => b.onclick = () => enqueue(`/api/documents/${b.dataset.condense}/condense`, {}));
  document.querySelectorAll("[data-emphasize]").forEach((b) => b.onclick = () => enqueue(`/api/applications/${a.id}/generate`, { what: "resume", emphasize: JSON.parse(b.dataset.emphasize), instructions: genNote() }));
  $("[data-ats-base]") && ($("[data-ats-base]").onclick = () => { state.ats = null; loadAts(a, null).then(() => render(true)); });
  $("#atsBox") && ($("#atsBox").ontoggle = () => { state.atsOpen = $("#atsBox").open; try { localStorage.setItem("atsOpen", state.atsOpen ? "1" : "0"); } catch {} });
  document.querySelectorAll("[data-learn]").forEach((b) => b.onclick = () => enqueue(`/api/documents/${b.dataset.learn}/learn`, {}));
  $("#saveDoc") && ($("#saveDoc").onclick = () => { const id = $("#saveDoc").dataset.doc, content = $("#docText").value; run(a.latex ? "Saving and rebuilding PDF…" : "Saving…", async () => { const r = await api("PUT", `/api/documents/${id}`, { content }); clearDrafts(`doc:${a.id}:${state.tab}:${id}`); state.app = await api("GET", `/api/applications/${a.id}`); state.docMode = "preview"; state.tex = null; if (r.pdfError) state.err = `Saved, but the PDF failed to build: ${r.pdfError}`; }); });

  $("#answerBtn") && ($("#answerBtn").onclick = () => {
    const questions = $("#qIn").value.split("\n").map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
    if (!questions.length) { state.err = "Paste at least one question."; render(); return; }
    enqueue(`/api/applications/${a.id}/questions`, { questions }).then(() => { if (!state.err) { clearDrafts(`qin:${a.id}:`); render(true); } });
  });
  document.querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => copyText($(`[data-q="${b.dataset.copy}"] .ans`).value).then((ok) => { b.textContent = ok ? "Copied" : "Blocked"; setTimeout(() => (b.textContent = "Copy"), 1200); }));
  document.querySelectorAll("[data-saveq]").forEach((b) => b.onclick = () => { const answer = $(`[data-q="${b.dataset.saveq}"] .ans`).value; run("Saving…", async () => { await api("PUT", `/api/questions/${b.dataset.saveq}`, { answer }); clearDrafts(`q:${a.id}:${b.dataset.saveq}`); state.app = await api("GET", `/api/applications/${a.id}`); }); });
  document.querySelectorAll("[data-revise]").forEach((b) => b.onclick = () => {
    const qid = b.dataset.revise;
    const instruction = b.dataset.reviseInstr || (document.getElementById(b.dataset.reviseInput)?.value || "").trim();
    if (!instruction) { state.err = "Describe how to revise it, e.g. “more specific”."; render(); return; }
    clearDrafts(`q:${a.id}:${qid}`);
    enqueue(`/api/questions/${qid}/revise`, { instruction }).then(() => { const inp = document.getElementById(b.dataset.reviseInput); if (inp) inp.value = ""; });
  });
  document.querySelectorAll("[data-delq]").forEach((b) => b.onclick = () => {
    const qid = Number(b.dataset.delq), q = a.questions.find((x) => x.id === qid);
    undoable({
      text: `Removed “${q.question.slice(0, 60)}${q.question.length > 60 ? "…" : ""}”`,
      apply: () => { a.questions = a.questions.filter((x) => x.id !== qid); render(true); },
      commit: async () => { await api("DELETE", `/api/questions/${qid}`); clearDrafts(`q:${a.id}:${qid}`); if (state.app?.id === a.id) state.app = await api("GET", `/api/applications/${a.id}`); render(true); },
      revert: async () => { if (state.app?.id === a.id) { state.app = await api("GET", `/api/applications/${a.id}`); render(true); } },
    });
  });

  // Apply panel
  $("#applyBtn") && ($("#applyBtn").onclick = () => { state.applyOpen = !state.applyOpen; render(true); });
  $("#statusOpen") && ($("#statusOpen").onclick = () => { state.statusOpen = true; render(true); });
  $("#headOpen") && ($("#headOpen").onclick = () => { state.headOpen = true; render(true); });
  $("#applyClose") && ($("#applyClose").onclick = () => { state.applyOpen = false; render(true); });
  for (const id of ["#applyCopyAns", "#copyAllAns"]) $(id) && ($(id).onclick = () => copyText(answersText(a)).then((ok) => { if (!ok) return notify("✗ The browser blocked the clipboard — use the Copy buttons on the Questions tab"); $(id).textContent = `Copied ${a.questions.length} ✓`; setTimeout(() => { const b = $(id); if (b) b.textContent = "⎘ Copy all answers"; }, 1500); }));
  document.querySelectorAll("[data-copy-text]").forEach((b) => b.onclick = () => { const doc = a.documents.find((d) => d.id === Number(b.dataset.copyText)); copyText(mdToText(doc.content)).then((ok) => { b.textContent = ok ? "Copied ✓" : "Blocked"; setTimeout(() => (b.textContent = "⎘ Copy text"), 1500); }); });
  $("#applyReveal") && ($("#applyReveal").onclick = () => run("Preparing the files…", async () => { const r = await api("POST", `/api/applications/${a.id}/reveal`, {}); if (!r.ok) notify(`Files are in ${r.path}`); }));
  $("#applyAutofill") && api("GET", `/api/applications/${a.id}/autofill-bookmarklet`).then(({ href }) => {
    const el = $("#applyAutofill"); if (!el) return;
    el.href = href; el.onclick = (e) => { e.preventDefault(); alert("Drag this link to your bookmarks bar, then click it while on this company's application form."); };
  });
  $("#applyMark") && ($("#applyMark").onclick = () => {
    const body = { status: "applied", applied_at: $("#applyDate").value || localDate() };
    const at = $("#applyNextAt").value, txt = $("#applyNextTxt").value.trim();
    if (at) { body.next_action_at = at; body.next_action = txt || "Follow up"; }
    state.applyOpen = false;
    patch(body).then(() => { if (!state.notice && !state.err) notify(`✓ Applied to ${a.company}${at ? ` — follow-up on ${at}` : ""}`); });
  });
}

// Fetch and cache the model list for a provider. `quiet` swallows errors (used
// for auto-load) and re-renders the settings screen on success.
const loading = new Set();
async function loadModels(provider, quiet) {
  if (loading.has(provider)) return;
  loading.add(provider);
  try {
    const models = await api("GET", `/api/models?provider=${provider}`);
    state.modelCache[provider] = models;
    if (!models.length && !quiet) throw new Error(provider === "ollama" ? "No models found — is Ollama running at that host, and have you pulled one (ollama pull llama3.1)?" : "No models returned (missing key?). You can still type a model id.");
    if (quiet && state.sel === "settings" && models.length && document.activeElement?.tagName !== "INPUT") render();
  } catch (e) {
    if (!quiet) throw e;
  } finally { loading.delete(provider); }
}

// ---------- ⌘K palette: applications, views, actions ----------
const pal = { open: false, q: "", idx: 0, items: [] };
function palItems(q) {
  const t = q.trim().toLowerCase();
  const hit = (s) => !t || s.toLowerCase().includes(t);
  const apps = state.apps.filter((a) => !state.pendingDeletes.has(a.id) && hit(`${a.company} ${a.role} ${a.location || ""} ${a.status}`))
    .slice(0, t ? 8 : 5).map((a) => ({ ic: icon("resume"), text: `${a.company} — ${a.role}`, sub: `${a.status}${a.location ? ` — ${a.location}` : ""}`, run: () => open(a.id) }));
  const views = [
    [icon("home"), "Home", () => go("home")], [icon("feed"), "Feed", () => go("feed")], [icon("goals"), "Goals", () => go("goals")], [icon("tasks"), "Tasks", () => go("tasks")],
    [icon("plus"), "New application — capture a posting", () => { state.newMode = "capture"; go("new"); }], [icon("pen"), "New application — log by hand", () => { state.newMode = "manual"; go("new"); }],
    [icon("refresh"), "Refresh the job feed", () => enqueue("/api/feed/refresh", {})], [icon("theme"), "Toggle dark mode", () => $("#themeBtn").click()], [icon("question"), "Keyboard shortcuts", () => { $("#helpOverlay").hidden = false; }],
    ...SETTINGS_SECTIONS.map(([k, ic, n]) => [ic, `Settings → ${n}`, () => go(`settings:${k}`)]),
  ].filter(([, n]) => hit(n)).map(([ic, text, run]) => ({ ic, text, run }));
  return [...apps, ...views].slice(0, 12);
}
function renderPal() {
  pal.items = palItems(pal.q); pal.idx = Math.min(pal.idx, Math.max(0, pal.items.length - 1));
  $("#palList").innerHTML = pal.items.map((it, i) => `<div class="pal-row ${i === pal.idx ? "on" : ""}" data-pal="${i}"><span class="ic">${it.ic}</span><span class="sp">${esc(it.text)}${it.sub ? ` <small>${esc(it.sub)}</small>` : ""}</span></div>`).join("") || '<div class="pal-row muted">Nothing matches.</div>';
  document.querySelectorAll("[data-pal]").forEach((r) => { r.onmouseenter = () => { pal.idx = Number(r.dataset.pal); renderPal(); }; r.onclick = () => palRun(); });
}
function palRun() { const it = pal.items[pal.idx]; if (!it) return; palClose(); it.run(); }
function palOpen() { pal.open = true; pal.q = ""; pal.idx = 0; $("#palette").hidden = false; $("#palQ").value = ""; renderPal(); $("#palQ").focus(); }
function palClose() { pal.open = false; $("#palette").hidden = true; }

// Keyboard: ⌘S saves the open editor; single keys navigate when not typing.
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pal.open ? palClose() : palOpen(); return; }
  if (pal.open) {
    if (e.key === "Escape") { palClose(); e.preventDefault(); }
    else if (e.key === "ArrowDown") { pal.idx = Math.min(pal.items.length - 1, pal.idx + 1); renderPal(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { pal.idx = Math.max(0, pal.idx - 1); renderPal(); e.preventDefault(); }
    else if (e.key === "Enter") { palRun(); e.preventDefault(); }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    const btn = $("#saveDoc") || $("#texSave") || $("#eSave");
    if (btn) { e.preventDefault(); btn.click(); }
    return;
  }
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (e.key === "Escape") {
    if (!$("#helpOverlay").hidden) { $("#helpOverlay").hidden = true; return; }
    if (typing) { document.activeElement.blur(); return; }
    if (state.sel !== null) go(isPhone() ? "apps" : "home");
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "?") { $("#helpOverlay").hidden = !$("#helpOverlay").hidden; e.preventDefault(); }
  else if (e.key === "/") { $("#search").focus(); $("#search").select(); e.preventDefault(); }
  else if (e.key === "n") { go("new"); e.preventDefault(); }
  else if (state.sel === "feed" && ["j", "k", "t", "x", "o", "s"].includes(e.key)) {
    // Triage the feed without the mouse: j/k move, t track, x remove, o open the posting, s score.
    const rows = [...document.querySelectorAll(".feed-item")];
    if (!rows.length) return;
    if (e.key === "j" || e.key === "k") {
      state.feedCursor = Math.max(0, Math.min(rows.length - 1, state.feedCursor + (e.key === "j" ? 1 : -1)));
      rows.forEach((r, i) => r.classList.toggle("cur", i === state.feedCursor));
      rows[state.feedCursor].scrollIntoView({ block: "nearest" });
      return;
    }
    const row = rows[state.feedCursor]; if (!row) return;
    const id = row.dataset.feedId;
    if (e.key === "t") $(`[data-feed-track="${id}"]`, row)?.click() ?? $(`[data-open-app]`, row)?.click();
    else if (e.key === "x") $(`[data-feed-dismiss="${id}"]`, row)?.click();
    else if (e.key === "o") { const l = row.querySelector('a[href^="http"]'); if (l) window.open(l.href, "_blank", "noopener"); }
    else if (e.key === "s") $(`[data-feed-score1="${id}"]`, row)?.click();
    e.preventDefault();
  }
  else if (e.key === "j" || e.key === "k") {
    const ids = [...document.querySelectorAll(".row")].map((r) => Number(r.dataset.id));
    if (!ids.length) return;
    const i = ids.indexOf(state.sel), next = e.key === "j" ? ids[Math.min(ids.length - 1, i + 1)] : ids[Math.max(0, i - 1)];
    if (next !== state.sel) open(next);
  }
  else if (/^[1-6]$/.test(e.key) && state.app) {
    const t = ["job", "resume", "cover_letter", "questions", "prep", "timeline"][Number(e.key) - 1];
    state.tab = t; state.editJob = false; state.docMode = "preview"; state.tex = null; state.viewDoc = null; render(true);
  }
});

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// Opened by the bookmarklet with ?capture=wait: the page text arrives either
// via the server (bookmarklet POSTed it) or via postMessage (fallback).
let captured = false;
function captureFromBrowser(d) {
  if (captured) return;
  captured = true;
  history.replaceState(null, "", "/");
  if (d.resumed_job) { // this page cleared a check a parked task was waiting on
    state.sel = "tasks"; state.app = null; state.busy = null;
    refreshJobs().then(() => notify(`✓ Handed over — “${d.label || "task"}” resumed`));
    return;
  }
  state.sel = "new"; state.app = null; state.busy = null;
  enqueue("/api/applications", { url: d.url, title: d.title, description: String(d.text || "").trim() });
}
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.type !== "jobtracker-capture") return;
  e.source?.postMessage("jobtracker-ack", e.origin);
  captureFromBrowser(d);
});
async function waitForCapture() {
  for (let i = 0; i < 60 && !captured; i++) {
    const d = await api("GET", "/api/captures/latest").catch(() => null);
    if (d) return captureFromBrowser(d);
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!captured) { state.busy = null; state.err = "Nothing arrived from the bookmarklet. Make sure the app was running and pop-ups are allowed, then try again — or paste the description below."; render(); }
}

(async () => {
  [state.profile, state.settings, state.jobs, state.goals] = await Promise.all([api("GET", "/api/profile"), api("GET", "/api/settings"), api("GET", "/api/jobs"), api("GET", "/api/goals").catch(() => null)]);
  await loadList();
  bindStatic();
  try { state.checklistHidden = localStorage.getItem("checklistHidden") === "1"; } catch {}
  api("GET", "/api/feed?status=open").then((f) => { state.feedHot = f.counts.unseen_hot; state.feedKeywords = f.settings.keywords.length; render(); }).catch(() => {});
  api("GET", "/api/activity").then((a) => { state.activity = a; render(); }).catch(() => { state.activity = []; });
  const params = new URLSearchParams(location.search);
  if (params.get("capture")) { state.sel = "new"; state.busy = "Waiting for the page from your browser…"; waitForCapture(); }
  else if (Number(params.get("app"))) { history.replaceState(null, "", "/"); state.tab = "questions"; await open(Number(params.get("app"))); return; }
  render();
  if ($("#bankQ")) $("#bankQ").dispatchEvent(new Event("input"));
})();
