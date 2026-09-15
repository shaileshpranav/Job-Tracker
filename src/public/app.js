const STATUSES = ["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn"];
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const state = { apps: [], filter: "all", sel: null, app: null, tab: "job", busy: null, profile: null, err: null, settings: null, modelCache: {}, editJob: false, docMode: "preview", tex: null, prompts: null, templates: null, style: null, jobs: [], notice: null, search: "", pasteFor: null, goals: null, celebrate: false, diffAgainst: "base", baseResume: null, feed: null, feedFilter: "hot", feedTest: null };

// ---------- tiny Markdown renderer (headings, lists, emphasis, links) ----------
function mdInline(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\*)(.+?)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
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
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// Runs an async action with a spinner. `fn` is started BEFORE the spinner
// re-renders the page so any form values it reads synchronously are still
// in the DOM; handlers must still read inputs before their first `await`.
async function run(label, fn) {
  state.err = null;
  const pending = fn();
  if (label) { state.busy = label; render(); }
  try { await pending; } catch (e) { state.err = e.message; }
  state.busy = null; render();
}

// ---------- tasks (queue) ----------
const activeJobs = () => state.jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "waiting");
const waitingJobs = () => state.jobs.filter((j) => j.status === "waiting");
const needOf = (j) => { try { return JSON.parse(j.need || "{}"); } catch { return {}; } };

// POST to an endpoint that enqueues a job; shows a notice instead of blocking.
async function enqueue(url, body, label) {
  state.err = null;
  try {
    const { job } = await api("POST", url, body);
    await refreshJobs();
    const position = activeJobs().filter((j) => j.status === "queued" && j.id < job.id).length;
    notify(`${job.label} — ${job.status === "running" ? "started" : position ? `queued (${position} ahead)` : "queued"}`);
  } catch (e) { state.err = e.message; }
  render();
}

function notify(text) { state.notice = text; render(); clearTimeout(notify.t); notify.t = setTimeout(() => { state.notice = null; render(); }, 3500); }

async function refreshJobs() {
  const prev = new Map(state.jobs.map((j) => [j.id, j.status]));
  state.jobs = await api("GET", "/api/jobs").catch(() => state.jobs);
  for (const j of state.jobs) {
    const was = prev.get(j.id);
    if (!was) continue;
    if ((was === "queued" || was === "running") && (j.status === "done" || j.status === "error")) await onJobFinished(j);
    else if (was !== "waiting" && j.status === "waiting") notify(`⚠ ${j.label} needs you — ${needOf(j).reason || "see Tasks"}`);
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
    notify(`✓ ${j.label} — ${j.type === "feed_refresh" ? `${result.added} new, ` : ""}${result.scored} scored, ${result.hot} hot${bad.length ? ` · ${bad.length} source${bad.length > 1 ? "s" : ""} failed: ${bad.map(([k, v]) => `${k} (${String(v).replace("failed: ", "")})`).join(", ")}` : ""}`);
    if (state.sel === "feed") { await loadFeed(); } else { const f = await api("GET", "/api/feed?status=open").catch(() => null); state.feedHot = f?.counts?.hot ?? 0; }
    return;
  }
  if (j.type === "capture" && state.sel === "feed") { await loadFeed(); return; }
  if (j.type === "learn") { state.style = null; notify(`✓ ${j.label} — ${result.rules} rule${result.rules === 1 ? "" : "s"} now guide future ${result.kind === "resume" ? "resumes" : "cover letters"} (see Settings)`); }
  if (j.type === "capture" && result.application_id && (state.sel === "new" || state.sel === null || state.sel === "tasks")) {
    state.tab = "job"; await open(result.application_id); return;
  }
  if (state.app && state.app.id === (j.application_id ?? result.application_id)) {
    state.app = await api("GET", `/api/applications/${state.app.id}`);
    if (j.type === "generate") { state.tab = result.what === "cover_letter" ? "cover_letter" : "resume"; state.docMode = "preview"; state.tex = null; }
    if (j.type === "condense") { state.docMode = "preview"; state.tex = null; }
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
  const icon = { queued: "◦", running: '<span class="spinner"></span>', waiting: '<span style="color:var(--warn)">⚠</span>', done: '<span style="color:var(--ok)">✓</span>', error: '<span style="color:var(--bad)">✗</span>', cancelled: '<span class="muted">–</span>' }[j.status];
  return `<div class="job ${j.status}" data-job="${j.id}">
    <span class="job-icon">${icon}</span>
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
      <div class="toolbar" style="margin-bottom:6px"><h3 style="margin:0">⚠ ${esc(j.label)} needs you</h3><div class="sp"></div><span class="muted">${esc(n.host || "")}</span></div>
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
        <div class="toolbar" style="margin:8px 0 0"><button class="primary" data-paste-save="${j.id}">Use this text</button><span class="muted">Or click the 📌 bookmarklet on the cleared page — it resumes this task automatically.</span></div>
      </div>` : `<p class="muted" style="margin:8px 0 0">Tip: with the 📌 Save to Job Tracker bookmarklet on your bookmarks bar, one click on the cleared page hands it over and resumes this task.</p>`}
    </div>`;
  }).join("");
}

// ---------- job feed ----------
async function loadFeed() {
  const status = { hot: "open", open: "open", unscored: "open", tracked: "tracked", dismissed: "dismissed" }[state.feedFilter] || "open";
  state.feed = await api("GET", `/api/feed?status=${status}`).catch(() => state.feed);
}

function renderFeed() {
  const f = state.feed;
  if (!f) return `${errBox()}<div class="card"><span class="spinner"></span>Loading feed…</div>`;
  const st = f.settings, c = f.counts;
  let items = f.items;
  if (state.feedFilter === "hot") items = items.filter((i) => i.status === "new" && i.fit_score >= st.minScore);
  if (state.feedFilter === "unscored") items = items.filter((i) => i.fit_score == null);
  const configured = st.boards.length || Object.values(st.aggregators).some(Boolean);
  const chips = [["hot", `🔥 Hot ${c.hot}`], ["open", `All open ${c.open}`], ["unscored", `Unscored ${c.unscored}`], ["tracked", "Tracked"], ["dismissed", "Dismissed"]];
  const dots = (n) => n == null ? '<span class="muted" title="Not scored yet">–</span>' : `<span class="dots small">${[1,2,3,4,5].map((i) => `<span class="dot ${i <= n ? "on f" + n : ""}"></span>`).join("")}</span>`;
  return `${errBox()}
    <div class="card">
      <div class="toolbar" style="margin:0">
        <div class="head-title"><h2>📡 Job feed</h2><div class="sub">${f.lastRefresh ? `Last refreshed ${fmtTime(f.lastRefresh)}` : "Never refreshed"}${st.autoHours ? ` · auto every ${st.autoHours}h` : ""} · ${st.keywords.length ? `keywords: ${esc(st.keywords.join(", "))}` : "<b>no keywords set</b>"}</div></div>
        <div class="sp"></div>
        ${c.unscored ? `<button id="feedScore" title="Triage the unscored postings with the feed model">★ Score ${Math.min(c.unscored, st.scorePerRefresh)} unscored</button>` : ""}
        <button class="primary" id="feedRefresh" ${configured ? "" : "disabled"}>↻ Refresh feed</button>
      </div>
    </div>
    ${configured ? "" : `<div class="banner">Nothing configured yet — add a few keywords and either company boards or an aggregator below, then Refresh.</div>`}
    <div class="filters" style="border:0;padding:0 0 12px">${chips.map(([k, n]) => `<button data-feed-filter="${k}" class="${state.feedFilter === k ? "on" : ""}">${n}</button>`).join("")}</div>
    ${items.length ? items.map((i) => `<div class="feed-item ${i.fit_score >= st.minScore ? "hot" : ""}">
      <div class="feed-score">${dots(i.fit_score)}${i.fit_score != null ? `<b>${i.fit_score}</b>` : ""}</div>
      <div class="feed-main">
        <div class="feed-title"><b>${esc(i.title)}</b> <span class="muted">at</span> ${esc(i.company)}</div>
        <div class="muted feed-meta">${esc(i.location || "")}${i.remote ? " · remote" : ""}${i.salary ? ` · ${esc(i.salary)}` : ""}${i.posted_at ? ` · ${i.posted_at}` : ""} · <span class="pill">${esc(i.source)}</span>${i.desc_len ? "" : ' · <span title="The API gave no description; tracking will fetch the page">no text</span>'}</div>
        ${i.fit_reason ? `<div class="feed-reason">${esc(i.fit_reason)}</div>` : ""}
      </div>
      <div class="feed-actions">
        ${i.status === "tracked" && i.application_id ? `<button class="primary" data-open-app="${i.application_id}">Open application ↗</button>`
          : `<button class="primary" data-feed-track="${i.id}" title="Create an application from this posting (full extraction + fit score)">＋ Track</button>`}
        <a href="${esc(i.url)}" target="_blank" rel="noopener"><button class="ghost">Posting ↗</button></a>
        ${i.fit_score == null && i.status === "new" ? `<button class="ghost" data-feed-score1="${i.id}" title="Score this one">★</button>` : ""}
        ${i.status === "dismissed" ? `<button class="ghost" data-feed-restore="${i.id}">Restore</button>` : i.status === "new" ? `<button class="ghost" data-feed-dismiss="${i.id}" title="Hide">×</button>` : ""}
      </div>
    </div>`).join("") : `<div class="card muted">${state.feedFilter === "hot" ? `Nothing scored ${st.minScore}+ yet. ${c.unscored ? "Score the unscored postings, or" : "Refresh the feed, or"} lower the threshold below.` : "Nothing here."}</div>`}
    ${state.feedFilter === "dismissed" && items.length ? `<div class="toolbar"><button class="ghost" id="feedPurge">Delete all dismissed</button></div>` : ""}

    <div class="card"><details ${configured ? "" : "open"}><summary style="cursor:pointer;font-weight:600">Feed settings</summary>
      <div class="grid2" style="margin-top:12px">
        <div class="field"><label>Keywords (one per line — all words of a line must appear in the title)</label><textarea id="fKeywords" placeholder="AI engineer\nmachine learning engineer\nforward deployed">${esc(st.keywords.join("\n"))}</textarea></div>
        <div class="field"><label>Locations to include (one per line; "remote" matches remote roles; empty = anywhere)</label><textarea id="fLocations" placeholder="Singapore\nremote\nDenmark\nCopenhagen">${esc(st.locations.join("\n"))}</textarea></div>
        <div class="field"><label>Exclude if title/location contains</label><textarea id="fExclude" style="min-height:60px">${esc(st.exclude.join("\n"))}</textarea></div>
        <div class="field"><label>Company boards (one per line: greenhouse:stripe · lever:spotify · ashby:ramp · workable:acme · smartrecruiters:Acme)</label><textarea id="fBoards" placeholder="greenhouse:stripe\nlever:spotify\nashby:ramp">${esc(st.boards.join("\n"))}</textarea>
          <div class="toolbar" style="margin:6px 0 0"><input id="fTest" placeholder="Test a board: greenhouse:stripe" style="flex:1"><button id="fTestBtn">Test</button></div>
          ${state.feedTest ? `<div class="muted" style="margin-top:4px">${state.feedTest.ok ? `✓ ${state.feedTest.count} postings — e.g. ${esc(state.feedTest.sample.join(" · "))}` : `<span class="err">✗ ${esc(state.feedTest.error)}</span>`}</div>` : ""}</div>
      </div>
      <div class="toolbar"><span class="muted">Aggregators:</span>
        ${[["arbeitnow", "Arbeitnow (Europe)"], ["remoteok", "RemoteOK"], ["remotive", "Remotive"]].map(([k, n]) => `<label style="display:inline-flex;align-items:center;gap:6px;margin:0"><input type="checkbox" data-agg="${k}" ${st.aggregators[k] ? "checked" : ""} style="width:auto">${n}</label>`).join("")}
      </div>
      <div class="grid3">
        <div class="field"><label>Hot at score ≥</label><input id="fMin" type="number" min="1" max="5" value="${st.minScore}"></div>
        <div class="field"><label>Max postings scored per refresh</label><input id="fCap" type="number" min="0" max="200" value="${st.scorePerRefresh}"></div>
        <div class="field"><label>Auto-refresh every (hours, 0 = off)</label><input id="fAuto" type="number" min="0" max="168" value="${st.autoHours}"></div>
      </div>
      <div class="toolbar" style="margin:0"><button class="primary" id="fSave">Save feed settings</button><span class="muted">Scoring uses the “Feed triage” task model (Settings → Per-task models) — a cheap/local model is fine here.</span></div>
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
        <div class="head-title"><h2>Level ${g.level.n} · ${esc(g.level.name)}</h2><div class="sub">${g.xp} XP · ${g.level.next - g.xp} to level ${g.level.n + 1} · ${g.total} application${g.total === 1 ? "" : "s"} sent</div></div>
        <div class="sp"></div>
        <div class="streak ${g.streak ? "hot" : ""}" title="Consecutive days hitting your daily goal${g.goals.weekends ? "" : " (weekends are rest days)"}"><span>🔥</span><b>${g.streak}</b><small>day streak<br>best ${g.best}</small></div>
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

    <div class="card"><h3>Targets</h3>
      <div class="grid3">
        <div class="field"><label>Per day</label><input id="gDaily" type="number" min="0" max="50" value="${g.goals.daily}"></div>
        <div class="field"><label>Per week</label><input id="gWeekly" type="number" min="0" max="300" value="${g.goals.weekly}"></div>
        <div class="field"><label>Per month</label><input id="gMonthly" type="number" min="0" max="1000" value="${g.goals.monthly}"></div>
      </div>
      <div class="field"><label>Nudge me to follow up after</label><div class="toolbar" style="margin:0"><input id="gFollow" type="number" min="0" max="90" value="${g.goals.followupDays}" style="width:90px"><span class="muted">days in <i>applied</i> / <i>screening</i> with no reply (0 = off). Shows as ⏰ in the list.</span></div></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink)"><input type="checkbox" id="gWeekends" ${g.goals.weekends ? "checked" : ""} style="width:auto"> Count weekends (untick to make Sat/Sun rest days that don't break a streak)</label>
      <div class="toolbar" style="margin:12px 0 0"><button class="primary" id="gSave">Save targets</button><span class="muted">Set a target to 0 to ignore it.</span></div>
    </div>`;
}

// Compact sidebar widget: today's progress + streak.
function goalWidget() {
  const g = state.goals; if (!g) return "";
  const d = g.periods.day;
  const pct = d.goal ? Math.min(100, Math.round((d.count / d.goal) * 100)) : 0;
  return `<div class="goal-mini ${d.met ? "met" : ""}" id="goalMini" title="Open goals">
    <span>🎯</span><div class="goal-bar"><div style="width:${pct}%"></div></div><b>${d.count}/${d.goal || "–"}</b><span class="muted">today</span>
    <span class="streak-mini ${g.streak ? "hot" : ""}">🔥 ${g.streak}</span></div>`;
}

// Toasts for what a status change just achieved.
function celebrate(c) {
  if (!c) return;
  const msgs = [];
  for (const h of c.hits) msgs.push(`🎯 ${h === "Today" ? "Daily" : h === "This week" ? "Weekly" : "Monthly"} goal hit!`);
  for (const a of c.unlocked) msgs.push(`${a.icon} Achievement unlocked: ${a.name}`);
  if (!msgs.length) return;
  state.notice = msgs.join("  ·  "); state.celebrate = true; render();
  clearTimeout(notify.t); notify.t = setTimeout(() => { state.notice = null; state.celebrate = false; render(); }, 6000);
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
async function open(id) { state.sel = id; state.editJob = false; state.docMode = "preview"; state.tex = null; state.app = await api("GET", `/api/applications/${id}`); state.err = null; render(); }

async function refresh() { await loadList(); if (typeof state.sel === "number") state.app = await api("GET", `/api/applications/${state.sel}`); render(); }

// ---------- render ----------
function render() {
  renderSidebar();
  const main = $("#main");
  // On phones the list and the detail are separate screens; body.detail picks which.
  document.body.classList.toggle("detail", state.sel !== null);
  const back = `<button class="back" id="backBtn">← Applications</button>`;
  const notice = (state.notice ? `<div class="notice ${state.celebrate ? "celebrate" : ""}">${esc(state.notice)}</div>` : "") + renderNeedsYou();
  if (state.sel === "tasks") main.innerHTML = back + notice + renderTasks();
  else if (state.sel === "goals") main.innerHTML = back + notice + renderGoals();
  else if (state.sel === "feed") main.innerHTML = back + notice + renderFeed();
  else if (state.sel === "new") main.innerHTML = back + notice + renderNew();
  else if (state.sel === "settings") main.innerHTML = back + notice + renderSettings();
  else if (state.app) main.innerHTML = back + notice + renderDetail(state.app);
  else if (state.sel === "home") main.innerHTML = back + notice + renderHome();
  else main.innerHTML = notice + renderHome();
  bind();
  if (window.innerWidth <= 768) window.scrollTo(0, 0);
}

function renderSidebar() {
  const counts = { all: state.apps.length };
  for (const a of state.apps) counts[a.status] = (counts[a.status] || 0) + 1;
  const due = state.apps.filter((a) => a.due).length;
  $("#filters").innerHTML = ["all", ...STATUSES].filter((s) => s === "all" || counts[s])
    .map((s) => `<button data-f="${s}" class="${state.filter === s ? "on" : ""}">${s} ${counts[s] || 0}</button>`).join("")
    + (due ? `<button data-f="due" class="due ${state.filter === "due" ? "on" : ""}">⏰ follow up ${due}</button>` : "");
  const q = state.search.trim().toLowerCase();
  const rows = state.apps.filter((a) => (state.filter === "all" || (state.filter === "due" ? a.due : a.status === state.filter)) && (!q || `${a.company} ${a.role} ${a.location || ""}`.toLowerCase().includes(q)));
  $("#list").innerHTML = rows.length ? rows.map((a) => `
    <div class="row ${a.id === state.sel ? "sel" : ""}" data-id="${a.id}">
      <b>${esc(a.company)}<span class="pill ${a.status}">${a.status}</span>${a.fit_score ? `<span class="pill fit f${a.fit_score}" title="Fit score">★ ${a.fit_score}</span>` : a.fit_status === "pending" ? `<span class="pill" title="Scoring fit…">★ …</span>` : ""}</b>
      <span>${esc(a.role)}</span><br>
      <small>${esc(a.location || "")}${a.applied_at ? ` · applied ${a.applied_at}` : ""}${a.due === "action" ? ` · <span class="due-txt">⏰ ${esc(a.next_action || "action due")}</span>` : a.due === "followup" ? ` · <span class="due-txt">⏰ ${a.days_since}d, follow up</span>` : ""}</small>
    </div>`).join("") : `<div class="empty" style="padding:40px 0">${state.apps.length ? "No matches" : "No applications yet"}</div>`;
  const s = state.settings;
  $("#llmFootText").textContent = s ? `${s.provider} · ${s.model}` : "";
  $("#logoutBtn").hidden = !s?.auth?.enabled;
  $("#goalWidget").innerHTML = goalWidget();
  const hot = state.feed?.counts?.hot ?? state.feedHot ?? 0;
  $("#feedBtn").innerHTML = hot ? `📡 <b>${hot}</b>` : "📡";
  $("#feedBtn").classList.toggle("active", hot > 0);
  const n = activeJobs().length;
  $("#tasksBtn").innerHTML = n ? `<span class="spinner"></span>${n}` : "⏱";
  $("#tasksBtn").classList.toggle("active", n > 0);
}

const PROVIDER_HELP = {
  anthropic: "Official Anthropic API. Best results — native PDF reading, guaranteed structured output, and a web-fetch fallback for scraper-blocked postings.",
  openrouter: "Hundreds of models behind one key. Model ids look like anthropic/claude-opus-5, openai/gpt-5, google/gemini-2.5-pro, meta-llama/llama-3.3-70b-instruct. Free-tier models are often unreliable at structured output.",
  ollama: "Local models, no key, nothing leaves your Mac. Needs Ollama running (ollama serve) and a pulled model (ollama pull llama3.1). Slower; small models give rougher drafts.",
};

function modelsFor(provider) { return state.modelCache[provider] || []; }

function renderSettings() {
  const s = state.settings;
  const models = modelsFor(s.provider);
  const local = s.provider === "ollama";
  const keyMask = s.keys[s.provider], keySrc = s.keySource[s.provider];
  return `${busy()}${errBox()}
    <div class="card"><h2>Default model</h2>
      <div class="field"><label>Provider</label>
        <div class="seg">${s.providers.map((p) => `<button data-provider="${p}" class="${p === s.provider ? "on" : ""}">${p}</button>`).join("")}</div></div>
      <p class="muted">${PROVIDER_HELP[s.provider]}</p>

      ${local ? `
      <div class="field"><label>Ollama host</label>
        <div class="toolbar" style="margin:0"><input id="sHost" value="${esc(s.ollamaHost)}" placeholder="http://localhost:11434" style="flex:1"><button id="sHostSave">Save host</button></div></div>`
      : `
      <div class="field"><label>API key ${keyMask ? `<span style="color:var(--ok)">● ${esc(keyMask)}</span> <span class="muted">(${keySrc === "app" ? "saved in app" : "from .env"})</span>` : `<span style="color:var(--bad)">● none</span>`}</label>
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
          <button class="ghost" id="sLoad">${models.length ? `↻ Reload list (${models.length})` : "Load available models"}</button>
        </div></div>
    </div>

    <div class="card"><h2>Security</h2>
      <p class="muted">${s.auth.enabled
        ? `Password required to open this app${s.auth.source === "env" ? " (set via <code>AUTH_PASSWORD</code> in .env)" : ""}. Sessions last 30 days per browser.`
        : "No password set — if this server is reachable on your network (see the phone URL printed at startup), anyone on it can open the app."}</p>
      <div class="field"><label>${s.auth.enabled ? "Change password" : "Set a password"}</label>
        <div class="toolbar" style="margin:0">
          <input id="sAuthPw" type="password" autocomplete="new-password" placeholder="At least 8 characters" style="flex:1">
          <button id="sAuthSave" class="primary">Save</button>
          ${s.auth.enabled && s.auth.source === "app" ? `<button id="sAuthClear">Remove password</button>` : ""}
        </div></div>
    </div>

    <div class="card"><h2>Learned formatting preferences</h2>
      <p class="muted">Rules the app has learned from your manual edits (🎓 on a resume / cover letter tab). Injected into every future generation as formatting guidance only — they never add or change facts. Edit freely; one rule per line.</p>
      ${state.style ? ["resume", "cover_letter"].map((k) => `<details class="prompt" data-style="${k}" ${state.style[k] ? "open" : ""}>
        <summary>${k === "resume" ? "Resume" : "Cover letter"} ${state.style[k] ? `<span class="pill accent">${state.style[k].split("\n").filter(Boolean).length} rules</span>` : '<span class="muted">none yet</span>'}</summary>
        <textarea class="styleText" style="min-height:120px;margin-top:6px" placeholder="- Keep every bullet to one line and start it with a verb\n- Put Education last\n- Dates as 'Mon YYYY – Mon YYYY'">${esc(state.style[k])}</textarea>
        <div class="toolbar" style="margin:6px 0 0"><button class="primary" data-style-save="${k}">Save</button>${state.style[k] ? `<button data-style-reset="${k}">Clear</button>` : ""}</div>
      </details>`).join("") : '<p class="muted">Loading…</p>'}
    </div>

    <div class="card"><h2>Prompts</h2>
      <p class="muted">Edit the instructions each task sends to the model. Your resume, notes, the job posting and previous answers are appended automatically — these are just the instruction parts. Blank = default.</p>
      ${state.prompts ? state.prompts.map((p) => `<details class="prompt" data-prompt="${p.key}" ${p.custom ? "open" : ""}>
        <summary>${esc(p.label)} ${p.custom ? '<span class="pill warn">customised</span>' : ""}</summary>
        <div class="muted" style="margin:6px 0">${esc(p.help)}</div>
        <textarea class="promptText" style="min-height:110px">${esc(p.current)}</textarea>
        <div class="toolbar" style="margin:6px 0 0"><button class="primary" data-prompt-save="${p.key}">Save</button>${p.custom ? `<button data-prompt-reset="${p.key}">Reset to default</button>` : ""}</div>
      </details>`).join("") : '<p class="muted">Loading…</p>'}
    </div>

    ${state.settings.latex !== false ? `<div class="card"><h2>PDF templates (LaTeX)</h2>
      <p class="muted">Global look of every generated PDF. Placeholders <code>{{NAME}}</code>, <code>{{CONTACT}}</code>, <code>{{BODY}}</code> (and <code>{{DATE}}</code> for letters) are filled from the Markdown. Spacing levers: <code>geometry</code> margins, <code>\\linespread</code>, <code>\\parskip</code>, <code>\\setlist</code> itemsep, <code>\\titlespacing</code>.</p>
      ${state.templates ? ["resume", "cover_letter"].map((k) => `<details class="prompt" data-template="${k}" ${state.templates[k].custom ? "open" : ""}>
        <summary>${k === "resume" ? "Resume template" : "Cover letter template"} ${state.templates[k].custom ? '<span class="pill warn">customised</span>' : ""}</summary>
        <textarea class="doc templateText" spellcheck="false" style="min-height:320px;margin-top:6px">${esc(state.templates[k].text)}</textarea>
        <div class="toolbar" style="margin:6px 0 0"><button class="primary" data-template-save="${k}">Save</button>${state.templates[k].custom ? `<button data-template-reset="${k}">Reset to default</button>` : ""}</div>
      </details>`).join("") : '<p class="muted">Loading…</p>'}
    </div>` : ""}

    <div class="card"><h2>Per-task models</h2>
      <p class="muted">Optional. Route individual tasks to a different provider/model — e.g. a free local model for capture, a strong hosted model for writing. Tasks left on “default” use the model above.</p>
      ${Object.entries(s.taskNames).map(([t, name]) => {
        const r = s.tasks[t];
        const prov = r?.provider ?? null;
        return `<div class="task-row" data-task="${t}">
          <div class="task-name">${esc(name)}${r ? `<div class="muted"><code>${esc(r.provider)} · ${esc(r.model)}</code></div>` : `<div class="muted">default (${esc(s.provider)} · ${esc(s.model)})</div>`}</div>
          <div class="seg">${["default", ...s.providers].map((p) => `<button data-task-provider="${p}" class="${(p === "default" ? !r : prov === p) ? "on" : ""}">${p}</button>`).join("")}</div>
          ${r ? comboHtml(`task_${t}`, r.provider, modelsFor(r.provider), r.model) : ""}
        </div>`;
      }).join("")}
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
  const p = state.profile;
  const banner = p && !p.hasMarkdown
    ? `<div class="banner">${p.hasSource
        ? `Found ${p.files.filter((f) => /\.(pdf|docx)$/i.test(f)).join(", ")} in <code>profile/</code>. <button id="importBtn">Import resume</button> to build <code>resume.md</code> (one-time, uses Claude).`
        : `No base resume yet. Drop <code>resume.pdf</code> or <code>resume.docx</code> into the <code>profile/</code> folder, then reload.`}</div>`
    : "";
  return `${busy()}${errBox()}${banner}
    <div class="card"><h2>How it works</h2>
      <ol>
        <li><b>New</b> → paste a posting URL or its text (or use the bookmarklet below). The model extracts company, role, requirements and any application questions, then scores how well the role <b>fits</b> your base resume.</li>
        <li><b>Generate</b> a one-page tailored resume and a cover letter. Preview, edit, or tweak the LaTeX, then <b>⬇ PDF</b>.</li>
        <li><b>Questions</b> → paste the form's questions; answers are drafted from your profile and your previous answers.</li>
        <li>Edit a document and hit <b>🎓 Learn my format</b> so future documents follow your formatting. Track <b>status</b> as things move; everything is mirrored to <code>applications/&lt;id-company-role&gt;/</code> as Markdown, TeX and PDF.</li>
      </ol>
      <p class="muted">Long-running actions queue as <b>⏱ Tasks</b> and run in the background. Models, keys and prompts live in <b>⚙ Settings</b>.</p>
      ${p?.hasMarkdown ? `<p class="muted">Base resume: <code>profile/resume.md</code> ✓</p>` : ""}
    </div>
    <div class="card"><h3>Capture from your browser (LinkedIn, Workday, anything)</h3>
      <p>Drag this to your bookmarks bar, then click it while viewing a job posting. It sends the page as <i>you</i> see it — logged in, fully rendered — so nothing gets blocked:</p>
      <p><a id="bookmarklet" class="bm" href="#" draggable="true">📌 Save to Job Tracker</a> <button id="bmCopy" style="margin-left:8px">Copy code</button> <span class="muted">(can't drag? copy, create a bookmark, paste as its URL)</span></p>
      <p class="muted">The app must be running when you click it. On your phone, copy the posting text and use <b>+ New → paste the description</b> instead.</p>
    </div>
    <div class="card"><h3>Backup & export</h3>
      <p class="muted">Everything lives on this machine. Take a copy now and then — the archive restores by unpacking it over a fresh checkout.</p>
      <div class="toolbar" style="margin:0"><a href="/api/export/backup"><button class="primary">⬇ Full backup (.tar.gz)</button></a><a href="/api/export/applications.csv"><button>⬇ Applications (.csv)</button></a><span class="muted">Backup = database, application folders, base resume, templates, secret key.</span></div>
    </div>
    <div class="card"><h3>Answer bank</h3>
      <input id="bankQ" placeholder="Search previous answers…">
      <div id="bank"></div>
    </div>`;
}

function renderNew() {
  return `${busy()}${errBox()}
    <div class="card"><h2>New application</h2>
      <div class="field"><label>Job posting URL</label><input id="nUrl" placeholder="https://…" autofocus></div>
      <details><summary class="muted">Or paste the description (for pages that block scraping)</summary>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label>Company</label><input id="nCompany"></div>
          <div class="field"><label>Role</label><input id="nRole"></div>
        </div>
        <div class="field"><label>Description</label><textarea id="nDesc" style="min-height:200px"></textarea></div>
      </details>
      <div class="toolbar" style="margin-top:12px"><button class="primary" id="captureBtn">Capture</button><button class="ghost" id="cancelNew">Cancel</button><span class="muted">Runs in the background — you'll be taken to the application when it's ready.</span></div>
    </div>`;
}

function renderDetail(a) {
  const tabs = ["job", "resume", "cover_letter", "questions", "prep", "timeline"];
  const names = { job: "Job", resume: "Resume", cover_letter: "Cover letter", questions: "Questions", prep: "Prep", timeline: "Timeline" };
  return `${busy()}${errBox()}
    <div class="card">
      <div class="toolbar">
        <div class="head-title"><h2>${esc(a.role)}</h2><div class="sub">${esc(a.company)}${a.location ? ` · ${esc(a.location)}` : ""}${a.salary ? ` · ${esc(a.salary)}` : ""} ${a.url ? `· <a href="${esc(a.url)}" target="_blank">posting ↗</a>` : ""}</div></div>
        <div class="sp"></div>
        <label style="margin:0;display:flex;align-items:center;gap:6px">Applied <input type="date" id="applied" value="${a.applied_at || ""}" style="width:auto"></label>
        <button id="delBtn" class="ghost icon" title="Delete application">🗑</button>
      </div>
      <div class="seg status-seg">${STATUSES.map((s) => `<button data-status="${s}" class="${s === a.status ? "on " + s : ""}">${s}</button>`).join("")}</div>
      <div class="grid2" style="gap:10px">
        <div class="field" style="margin:0"><label>Notes</label><textarea id="notes" style="min-height:60px">${esc(a.notes)}</textarea></div>
        <div class="field" style="margin:0"><label>Next action</label>
          <div class="toolbar" style="margin:0;flex-wrap:nowrap"><input type="date" id="nextAt" value="${a.next_action_at || ""}" style="width:auto"><input id="nextTxt" placeholder="e.g. chase recruiter, prep for screen" value="${esc(a.next_action || "")}"></div>
          <div class="toolbar" style="margin:6px 0 0"><button data-log="followup" title="Logs a follow-up today and clears the next action">✓ Followed up</button><button data-log="call">☎ Call</button><button data-log="interview">🤝 Interview</button>${a.followed_up_at ? `<span class="muted">last follow-up ${a.followed_up_at}</span>` : ""}</div>
        </div>
      </div>
    </div>
    <div class="tabs">${tabs.map((t) => `<button data-tab="${t}" class="${state.tab === t ? "on" : ""}">${names[t]}</button>`).join("")}</div>
    ${jobBadge(a.id, { job: ["reextract", "fit"], resume: ["generate", "condense", "learn"], cover_letter: ["generate", "learn"], questions: ["questions"], prep: ["prep"], timeline: [] }[state.tab])}
    ${({ job: renderJob, resume: () => renderDoc(a, "resume"), cover_letter: () => renderDoc(a, "cover_letter"), questions: renderQuestions, prep: renderPrep, timeline: renderTimeline })[state.tab](a)}`;
}

function renderFit(a) {
  const f = a.fit;
  const dots = (n) => [1,2,3,4,5].map((i) => `<span class="dot ${i <= n ? "on f" + n : ""}"></span>`).join("");
  if (a.fit_status === "pending") return `<div class="card fit"><span class="spinner"></span>Scoring fit against your base resume…</div>`;
  if (a.fit_status === "error") return `<div class="card fit"><span class="err">Fit scoring failed: ${esc(f?.error || "unknown error")}</span> <button data-fit>Retry</button></div>`;
  if (!f) return `<div class="card fit"><div class="toolbar" style="margin:0"><span class="muted">${state.profile?.hasMarkdown ? "Not scored yet." : "Import your resume first, then score how well this role fits."}</span><div class="sp"></div><button data-fit ${state.profile?.hasMarkdown ? "" : "disabled"}>★ Score fit</button></div></div>`;
  const chips = (arr, cls) => arr.length ? arr.map((x) => `<span class="req ${cls}">${esc(x)}</span>`).join("") : '<span class="muted">none</span>';
  return `<div class="card fit">
    <div class="toolbar" style="margin:0 0 6px"><div class="dots">${dots(f.score)}</div><b style="font-size:16px">${f.score}/5</b><span>${esc(f.verdict)}</span><div class="sp"></div><button data-fit title="Re-score (e.g. after updating resume.md)">↻ Re-score</button></div>
    <div class="fitgrid">
      <div><h4>Met</h4>${chips(f.met, "ok")}</div>
      <div><h4>Partial</h4>${chips(f.partial, "warn")}</div>
      <div><h4>Missing</h4>${chips(f.missing, "bad")}</div>
    </div>
    <p style="margin:10px 0 0"><b>Advice:</b> ${esc(f.advice)}</p>
  </div>`;
}

function renderJob(a) {
  if (state.editJob) return `<div class="card">
    <h3>Edit job details</h3>
    <div class="grid2">
      <div class="field"><label>Company</label><input id="eCompany" value="${esc(a.company)}"></div>
      <div class="field"><label>Role</label><input id="eRole" value="${esc(a.role)}"></div>
      <div class="field"><label>Location</label><input id="eLocation" value="${esc(a.location || "")}"></div>
      <div class="field"><label>Salary</label><input id="eSalary" value="${esc(a.salary || "")}"></div>
    </div>
    <div class="field"><label>Posting URL</label><input id="eUrl" value="${esc(a.url || "")}"></div>
    <div class="field"><label>Key requirements (one per line)</label><textarea id="eReqs" style="min-height:120px">${esc(a.requirements.join("\n"))}</textarea></div>
    <div class="field"><label>Description (Markdown)</label><textarea id="eDesc" class="doc" style="min-height:260px">${esc(a.description || "")}</textarea></div>
    <div class="toolbar"><button class="primary" id="eSave">Save</button><button id="eCancel">Cancel</button></div>
  </div>`;
  return `${renderFit(a)}<div class="card">
    <div class="toolbar"><h3 style="margin:0">Key requirements</h3><div class="sp"></div>
      <button data-reextract="description" title="${a.has_source_text ? "Re-run extraction on the original captured page text with the current capture model" : "Re-run extraction on the saved description with the current capture model"}">↻ Re-extract</button>
      ${a.url ? `<button data-reextract="url" title="Fetch the posting again and re-extract">↻ Fetch again</button>` : ""}
      <button id="editJob">✎ Edit</button></div>
    ${!a.requirements.length || !a.location ? `<div class="banner" style="margin:8px 0">Looks thin (${[!a.location && "no location", !a.salary && "no salary", !a.requirements.length && "no requirements"].filter(Boolean).join(", ")}). The page may have been a JavaScript shell — use the <b>Save to Job Tracker</b> bookmarklet from the home screen on the posting, or paste the description via ✎ Edit, then ↻ Re-extract.</div>` : ""}
    <div>${a.requirements.map((r) => `<span class="req">${esc(r)}</span>`).join("") || '<span class="muted">none extracted</span>'}</div>
    <h3 style="margin-top:16px">Description</h3><div class="doc" style="min-height:0">${esc(a.description)}</div>
  </div>`;
}

function renderDoc(a, kind) {
  const docs = a.documents.filter((d) => d.kind === kind);
  const doc = docs[0];
  const label = kind === "resume" ? "resume" : "cover letter";
  const mode = state.docMode;
  const fit = doc && kind === "resume" ? (doc.size.words <= a.one_page.words && doc.size.lines <= a.one_page.lines) : null;
  const overflow = doc && kind === "resume" && (doc.pages && doc.pdf_current ? doc.pages > 1 : !fit);
  const pageInfo = doc && doc.pages && doc.pdf_current
    ? (kind === "resume" ? (doc.pages === 1 ? ' · <span style="color:var(--ok)">1 page (PDF)</span>' : ` · <span style="color:var(--warn)">${doc.pages} pages (PDF)</span>`) : ` · ${doc.pages} page${doc.pages > 1 ? "s" : ""} (PDF)`)
    : kind === "resume" ? (fit ? ' · <span style="color:var(--ok)">likely one page</span>' : ' · <span style="color:var(--warn)">may run past one page</span>') : "";
  const sizeInfo = doc ? `<span class="muted" title="One-page budget: ≤${a.one_page.words} words, ≤${a.one_page.lines} lines">${doc.size.words} words · ${doc.size.lines} lines${pageInfo}${doc.custom_tex ? ' <span class="pill warn">custom LaTeX</span>' : ""}${doc.edited ? ' <span class="pill accent">edited by you</span>' : ""}</span>` : "";
  let body = "";
  if (doc) {
    if (mode === "edit") body = `${doc.custom_tex ? `<div class="banner">This version has hand-edited LaTeX. Saving Markdown edits regenerates the LaTeX from the Markdown (your TeX tweaks will be dropped).</div>` : ""}<textarea class="doc" id="docText">${esc(doc.content)}</textarea>`;
    else if (mode === "tex") body = state.tex && state.tex.id === doc.id
      ? `<div class="muted" style="margin-bottom:6px">Full document — edit anything. To fit one page, the usual levers are near the top: <code>geometry</code> margins, <code>\\linespread</code>, <code>\\parskip</code>, the <code>itemsep</code>/<code>topsep</code> in <code>\\setlist</code>, <code>\\titlespacing</code>, and the <code>[10.5pt]</code> in <code>\\documentclass</code>. Global changes belong in Settings → PDF templates.</div>
         <textarea class="doc" id="texText" spellcheck="false" style="min-height:480px">${esc(state.tex.tex)}</textarea>
         <div class="toolbar" style="margin-top:8px"><button class="primary" id="texSave">Save & rebuild PDF</button>${state.tex.custom ? `<button id="texReset">Reset to generated</button>` : ""}<div class="sp"></div><span class="muted" id="texResult"></span></div>`
      : `<p class="muted"><span class="spinner"></span>Loading LaTeX…</p>`;
    else if (mode === "diff") {
      const options = [...(kind === "resume" ? [["base", "Base resume (profile/resume.md)"]] : []), ...docs.slice(1).map((d, i) => [String(d.id), `v${docs.length - 1 - i} · ${fmtTime(d.created_at)}`])];
      const sel = options.some(([v]) => v === state.diffAgainst) ? state.diffAgainst : options[0]?.[0];
      const other = sel === "base" ? state.baseResume : docs.find((d) => String(d.id) === sel)?.content;
      body = `<div class="toolbar"><span class="muted">Compare this version with</span><div class="seg wrap">${options.map(([v, n]) => `<button data-diff="${v}" class="${sel === v ? "on" : ""}">${esc(n)}</button>`).join("") || '<span class="muted">nothing yet — only one version</span>'}</div></div>
        ${other == null ? (sel === "base" ? '<p class="muted"><span class="spinner"></span>Loading base resume…</p>' : "") : `<div class="diff-legend muted"><span class="d-add">added</span> <span class="d-del">removed</span> — a quick way to spot anything the model invented or dropped.</div><div class="diff">${renderDiff(other, doc.content)}</div>`}`;
    }
    else body = `<div class="preview ${kind}">${mdToHtml(doc.content)}</div>`;
  } else body = `<p class="muted">No ${label} yet. Generation uses <code>profile/resume.md</code> + this job's description${kind === "resume" ? ", and is constrained to one page" : ""}.</p>`;
  const modes = [["preview", "Preview"], ["edit", "Edit"], ...(a.latex ? [["tex", "LaTeX"]] : []), ["diff", "Compare"]];
  return `<div class="card">
    <div class="doc-actions">
      <div class="doc-group"><span>Generate</span><div>
        <button class="${doc ? "" : "primary"}" data-gen="${kind}">✨ ${doc ? "Regenerate" : "Generate"} ${label}</button>
        ${kind === "resume" ? `<button data-gen="both" title="Resume first, then a cover letter based on it">Resume + cover letter</button>` : ""}
      </div></div>
      ${doc ? `<div class="doc-group"><span>Refine</span><div>
        ${kind === "resume" ? `<button data-condense="${doc.id}" class="${overflow ? "primary" : ""}" title="Ask the model to cut this version down to one page (saves as a new version)">✂ Condense</button>` : ""}
        <button data-learn="${doc.id}" ${doc.edited ? "" : "disabled"} title="${doc.edited ? "Compare your edits with the generated version and update the formatting rules for future " + label + "s (content is ignored)" : "Edit and save the Markdown first, then the app can learn your formatting preferences"}">🎓 Learn my format</button>
      </div></div>
      <div class="doc-right">
      <div class="doc-group"><span>View</span><div><div class="seg">${modes.map(([m, n]) => `<button data-docmode="${m}" class="${mode === m ? "on" : ""}">${n}</button>`).join("")}</div></div></div>
      <div class="doc-group"><span>Export</span><div>
        ${a.latex ? `<a href="/doc/${doc.id}.pdf" target="_blank"><button class="primary">⬇ PDF</button></a><a href="/doc/${doc.id}" target="_blank"><button class="ghost" title="Browser print fallback">Print</button></a>` : `<a href="/doc/${doc.id}" target="_blank"><button class="primary">Print / Save as PDF</button></a>`}
      </div></div>
      </div>` : ""}
    </div>
    ${doc ? `<div class="doc-meta"><span class="v">v${docs.length}</span><span>${fmtTime(doc.created_at)}</span><span>·</span>${sizeInfo}<div class="sp" style="flex:1"></div>${mode === "edit" ? `<button id="saveDoc" class="primary" data-doc="${doc.id}">Save edits</button>` : ""}</div>` : ""}
    ${body}
  </div>`;
}

function renderQuestions(a) {
  const found = a.events.find((e) => e.kind === "questions_found");
  return `<div class="card">
    <h3>Paste application questions (one per line)</h3>
    <textarea id="qIn" placeholder="Why do you want to work at ${esc(a.company)}?\nDescribe a project you're proud of.">${found && !a.questions.length ? esc(found.detail) : ""}</textarea>
    <div class="toolbar" style="margin-top:8px"><button class="primary" id="answerBtn">Draft answers</button><span class="muted">Reuses your answers from other applications where they fit.</span></div>
  </div>
  ${a.questions.map((q) => `<div class="qa" data-q="${q.id}">
    <h4>${esc(q.question)}</h4>
    <textarea class="ans">${esc(q.answer)}</textarea>
    <div class="toolbar" style="margin:8px 0 0"><button data-copy="${q.id}">Copy</button><button data-saveq="${q.id}">Save</button><div class="sp"></div><button data-delq="${q.id}">Remove</button></div>
  </div>`).join("")}`;
}

function renderPrep(a) {
  const doc = a.documents.find((d) => d.kind === "prep");
  return `<div class="card">
    <div class="toolbar"><button class="${doc ? "" : "primary"}" id="prepBtn">${doc ? "↻ Regenerate prep sheet" : "🎓 Prepare me for the interview"}</button><div class="sp"></div>${doc ? `<span class="muted">${fmtTime(doc.created_at)}</span>` : ""}</div>
    ${doc ? `<div class="preview">${mdToHtml(doc.content)}</div>` : `<p class="muted">A prep sheet for <b>this</b> role: how to pitch yourself, likely questions with talking points from your own experience, how to handle the gaps the fit score found, stories to have ready, and questions to ask them.${a.fit ? "" : " Score the fit first for better gap coverage."}</p>`}
  </div>`;
}

const EV_ICON = { created: "✨", status: "➜", generated: "📄", questions: "💬", questions_found: "❓", fit: "★", edited: "✎", reextracted: "↻", learned: "🎓", note: "📝", followup: "✓", call: "☎", interview: "🤝" };
function renderTimeline(a) {
  return `<div class="card">
    <div class="toolbar"><input id="noteTxt" placeholder="Log a note — recruiter name, what they said, salary mentioned…" style="flex:1"><button id="noteAdd">Add note</button></div>
    ${a.events.map((e) => `<div class="ev"><small>${fmtTime(e.created_at)}</small><b>${EV_ICON[e.kind] || "•"} ${esc(e.kind.replace("_", " "))}</b><span style="flex:1;white-space:pre-wrap">${esc(e.detail)}</span>${["note", "followup", "interview", "call"].includes(e.kind) ? `<button class="ghost icon" data-ev-del="${e.id}" title="Remove">×</button>` : ""}</div>`).join("") || '<span class="muted">No events</span>'}</div>
    <p class="muted">Files: <code>applications/${esc(a.folder)}/</code></p>`;
}

const busy = () => state.busy ? `<div class="card"><span class="spinner"></span>${esc(state.busy)}</div>` : "";
const errBox = () => state.err ? `<div class="card err">${esc(state.err)}</div>` : "";

// ---------- events ----------
function bindList() {
  document.querySelectorAll(".row").forEach((r) => r.onclick = () => open(Number(r.dataset.id)));
  document.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { state.filter = b.dataset.f; render(); });
}
function bind() {
  const sb = $("#search");
  if (sb && sb.value !== state.search) sb.value = state.search;
  if (sb) sb.oninput = () => { state.search = sb.value; renderSidebar(); bindList(); };
  bindList();
  $("#newBtn").onclick = () => { state.sel = "new"; state.app = null; state.err = null; render(); };
  $("#settingsBtn").onclick = () => { state.sel = "settings"; state.app = null; state.err = null; render(); loadModels(state.settings.provider, true); };
  $("#homeBtn").onclick = () => { state.sel = "home"; state.app = null; state.err = null; render(); };
  $("#themeBtn").onclick = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch {}
  };
  $("#logoutBtn").onclick = () => run(null, async () => { await api("POST", "/api/logout"); location.href = "/"; });
  $("#backBtn") && ($("#backBtn").onclick = () => { state.sel = null; state.app = null; state.err = null; render(); });
  document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; state.editJob = false; state.docMode = "preview"; state.tex = null; state.err = null; render(); });

  if ($("#sSave")) {
    const saveDefault = (body, label) => run(label, async () => { state.settings = await api("PUT", "/api/settings", body); });
    document.querySelectorAll("[data-provider]").forEach((b) => b.onclick = () => saveDefault({ provider: b.dataset.provider }, `Switching to ${b.dataset.provider}…`));
    $("#sSave").onclick = () => { const model = $("#sModel").value.trim(); if (!model) { state.err = "Type a model id first."; render(); return; } saveDefault({ model }, "Saving…"); };
    $("#sLoad").onclick = () => run("Fetching model list…", () => loadModels(state.settings.provider, false));
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

  $("#importBtn") && ($("#importBtn").onclick = () => enqueue("/api/profile/import", {}, "Import resume"));
  $("#tasksBtn").onclick = () => { state.sel = "tasks"; state.app = null; state.err = null; render(); };
  $("#feedBtn").onclick = () => { state.sel = "feed"; state.app = null; state.err = null; render(); loadFeed().then(render); };
  if (state.sel === "feed") {
    document.querySelectorAll("[data-feed-filter]").forEach((b) => b.onclick = () => { state.feedFilter = b.dataset.feedFilter; loadFeed().then(render); });
    $("#feedRefresh") && ($("#feedRefresh").onclick = () => enqueue("/api/feed/refresh", {}));
    $("#feedScore") && ($("#feedScore").onclick = () => enqueue("/api/feed/score", {}));
    document.querySelectorAll("[data-feed-score1]").forEach((b) => b.onclick = () => enqueue("/api/feed/score", { ids: [Number(b.dataset.feedScore1)] }));
    document.querySelectorAll("[data-feed-track]").forEach((b) => b.onclick = () => enqueue(`/api/feed/${b.dataset.feedTrack}/track`, {}));
    document.querySelectorAll("[data-feed-dismiss]").forEach((b) => b.onclick = () => run(null, async () => { await api("POST", `/api/feed/${b.dataset.feedDismiss}/dismiss`); await loadFeed(); }));
    document.querySelectorAll("[data-feed-restore]").forEach((b) => b.onclick = () => run(null, async () => { await api("POST", `/api/feed/${b.dataset.feedRestore}/restore`); await loadFeed(); }));
    document.querySelectorAll("[data-open-app]").forEach((b) => b.onclick = () => open(Number(b.dataset.openApp)));
    $("#feedPurge") && ($("#feedPurge").onclick = () => run(null, async () => { await api("DELETE", "/api/feed/dismissed"); await loadFeed(); }));
    $("#fTestBtn") && ($("#fTestBtn").onclick = () => { const board = $("#fTest").value; run("Testing board…", async () => { state.feedTest = await api("POST", "/api/feed/test", { board }); }); });
    $("#fSave") && ($("#fSave").onclick = () => {
      const body = { keywords: $("#fKeywords").value, locations: $("#fLocations").value, exclude: $("#fExclude").value, boards: $("#fBoards").value,
        aggregators: Object.fromEntries([...document.querySelectorAll("[data-agg]")].map((c) => [c.dataset.agg, c.checked])),
        minScore: $("#fMin").value, scorePerRefresh: $("#fCap").value, autoHours: $("#fAuto").value };
      run("Saving feed settings…", async () => { await api("PUT", "/api/feed/settings", body); await loadFeed(); });
    });
  }
  $("#goalMini") && ($("#goalMini").onclick = () => { state.sel = "goals"; state.app = null; state.err = null; render(); loadGoals().then(render); });
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
    $("#bmCopy").onclick = () => navigator.clipboard.writeText(href).then(() => { $("#bmCopy").textContent = "Copied"; setTimeout(() => ($("#bmCopy").textContent = "Copy code"), 1200); });
  });
  $("#bankQ") && ($("#bankQ").oninput = debounce(async () => {
    const rows = await api("GET", `/api/qa-bank?q=${encodeURIComponent($("#bankQ").value)}`);
    $("#bank").innerHTML = rows.map((q) => `<div class="qa"><h4>${esc(q.question)}</h4><div class="muted" style="margin-bottom:6px">${esc(q.company)} · ${esc(q.role)}</div><div style="white-space:pre-wrap">${esc(q.answer)}</div></div>`).join("") || '<p class="muted">Nothing yet.</p>';
  }, 250));

  $("#cancelNew") && ($("#cancelNew").onclick = () => { state.sel = null; render(); });
  $("#captureBtn") && ($("#captureBtn").onclick = () => {
    const body = { url: $("#nUrl").value.trim(), company: $("#nCompany").value.trim(), role: $("#nRole").value.trim(), description: $("#nDesc").value.trim() };
    if (!body.url && !body.description) { state.err = "Paste a job posting URL, or open the section below and paste the description."; render(); return; }
    enqueue("/api/applications", body).then(() => { if (!state.err) { $("#nUrl") && ($("#nUrl").value = ""); $("#nDesc") && ($("#nDesc").value = ""); } });
  });

  const a = state.app;
  if (!a) return;
  const patch = (body) => run(null, async () => {
    state.app = await api("PATCH", `/api/applications/${a.id}`, body);
    await loadList();
    if ("status" in body || "applied_at" in body) { await loadGoals(); celebrate(state.app.celebrate); }
  });
  document.querySelectorAll("[data-status]").forEach((b) => b.onclick = () => patch({ status: b.dataset.status }));
  $("#applied").onchange = (e) => patch({ applied_at: e.target.value || null });
  $("#notes").onchange = (e) => patch({ notes: e.target.value });
  $("#nextAt").onchange = (e) => patch({ next_action_at: e.target.value || null });
  $("#nextTxt").onchange = (e) => patch({ next_action: e.target.value.trim() || null });
  document.querySelectorAll("[data-log]").forEach((b) => b.onclick = () => run(null, async () => { state.app = await api("POST", `/api/applications/${a.id}/events`, { kind: b.dataset.log }); await loadList(); }));
  $("#noteAdd") && ($("#noteAdd").onclick = () => { const detail = $("#noteTxt").value.trim(); if (!detail) return; run(null, async () => { state.app = await api("POST", `/api/applications/${a.id}/events`, { kind: "note", detail }); }); });
  $("#noteTxt") && ($("#noteTxt").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#noteAdd").click(); } });
  document.querySelectorAll("[data-ev-del]").forEach((b) => b.onclick = () => run(null, async () => { state.app = await api("DELETE", `/api/events/${b.dataset.evDel}`); }));
  $("#prepBtn") && ($("#prepBtn").onclick = () => enqueue(`/api/applications/${a.id}/prep`, {}));
  $("#editJob") && ($("#editJob").onclick = () => { state.editJob = true; render(); });
  document.querySelectorAll("[data-fit]").forEach((b) => b.onclick = () => enqueue(`/api/applications/${a.id}/fit`, {}));
  document.querySelectorAll("[data-reextract]").forEach((b) => b.onclick = () => enqueue(`/api/applications/${a.id}/reextract`, { source: b.dataset.reextract }));
  $("#eCancel") && ($("#eCancel").onclick = () => { state.editJob = false; render(); });
  $("#eSave") && ($("#eSave").onclick = () => {
    const body = {
      company: $("#eCompany").value.trim(), role: $("#eRole").value.trim(), location: $("#eLocation").value.trim() || null,
      salary: $("#eSalary").value.trim() || null, url: $("#eUrl").value.trim() || null, description: $("#eDesc").value,
      requirements: $("#eReqs").value.split("\n").map((r) => r.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean),
    };
    if (!body.company || !body.role) { state.err = "Company and role are required."; render(); return; }
    run("Saving…", async () => { state.app = await api("PATCH", `/api/applications/${a.id}`, body); state.editJob = false; await loadList(); });
  });
  $("#delBtn").onclick = async () => { if (confirm(`Delete ${a.company} — ${a.role}? Files on disk are kept.`)) { await api("DELETE", `/api/applications/${a.id}`); state.sel = null; state.app = null; await refresh(); } };

  document.querySelectorAll("[data-gen]").forEach((b) => b.onclick = () => enqueue(`/api/applications/${a.id}/generate`, { what: b.dataset.gen }));
  document.querySelectorAll("[data-diff]").forEach((b) => b.onclick = () => { state.diffAgainst = b.dataset.diff; render(); });
  document.querySelectorAll("[data-docmode]").forEach((b) => b.onclick = () => {
    state.docMode = b.dataset.docmode; render();
    if (state.docMode === "diff" && state.baseResume == null) api("GET", "/api/profile/resume").then((r) => { state.baseResume = r.markdown; if (state.docMode === "diff") render(); }).catch(() => { state.baseResume = ""; });
    if (state.docMode === "tex") {
      const doc = a.documents.find((d) => d.kind === state.tab);
      if (doc && state.tex?.id !== doc.id) api("GET", `/api/documents/${doc.id}/tex`).then((t) => { state.tex = { id: doc.id, ...t }; if (state.docMode === "tex") render(); });
    }
  });
  $("#texSave") && ($("#texSave").onclick = () => { const tex = $("#texText").value, id = state.tex.id; run("Compiling LaTeX…", async () => {
    const r = await api("PUT", `/api/documents/${id}/tex`, { tex });
    state.tex = { id, tex, custom: true };
    state.app = await api("GET", `/api/applications/${a.id}`);
    if (!r.ok) state.err = r.error; else state.err = null;
  }); });
  $("#texReset") && ($("#texReset").onclick = () => run("Regenerating LaTeX from Markdown…", async () => { await api("PUT", `/api/documents/${state.tex.id}/tex`, { reset: true }); state.tex = null; state.app = await api("GET", `/api/applications/${a.id}`); const doc = state.app.documents.find((d) => d.kind === state.tab); const t = await api("GET", `/api/documents/${doc.id}/tex`); state.tex = { id: doc.id, ...t }; }));
  document.querySelectorAll("[data-condense]").forEach((b) => b.onclick = () => enqueue(`/api/documents/${b.dataset.condense}/condense`, {}));
  document.querySelectorAll("[data-learn]").forEach((b) => b.onclick = () => enqueue(`/api/documents/${b.dataset.learn}/learn`, {}));
  $("#saveDoc") && ($("#saveDoc").onclick = () => { const id = $("#saveDoc").dataset.doc, content = $("#docText").value; run(a.latex ? "Saving and rebuilding PDF…" : "Saving…", async () => { const r = await api("PUT", `/api/documents/${id}`, { content }); state.app = await api("GET", `/api/applications/${a.id}`); state.docMode = "preview"; state.tex = null; if (r.pdfError) state.err = `Saved, but the PDF failed to build: ${r.pdfError}`; }); });

  $("#answerBtn") && ($("#answerBtn").onclick = () => {
    const questions = $("#qIn").value.split("\n").map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
    if (!questions.length) { state.err = "Paste at least one question."; render(); return; }
    enqueue(`/api/applications/${a.id}/questions`, { questions });
  });
  document.querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => { navigator.clipboard.writeText($(`[data-q="${b.dataset.copy}"] .ans`).value); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200); });
  document.querySelectorAll("[data-saveq]").forEach((b) => b.onclick = () => { const answer = $(`[data-q="${b.dataset.saveq}"] .ans`).value; run("Saving…", async () => { await api("PUT", `/api/questions/${b.dataset.saveq}`, { answer }); state.app = await api("GET", `/api/applications/${a.id}`); }); });
  document.querySelectorAll("[data-delq]").forEach((b) => b.onclick = () => run(null, async () => { await api("DELETE", `/api/questions/${b.dataset.delq}`); state.app = await api("GET", `/api/applications/${a.id}`); }));
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

// ⌘S / Ctrl+S saves whichever editor is open.
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
  const btn = $("#saveDoc") || $("#texSave") || $("#eSave");
  if (btn) { e.preventDefault(); btn.click(); }
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
  api("GET", "/api/feed?status=open").then((f) => { state.feedHot = f.counts.hot; renderSidebar(); }).catch(() => {});
  if (new URLSearchParams(location.search).get("capture")) { state.sel = "new"; state.busy = "Waiting for the page from your browser…"; waitForCapture(); }
  render();
  if ($("#bankQ")) $("#bankQ").dispatchEvent(new Event("input"));
})();
