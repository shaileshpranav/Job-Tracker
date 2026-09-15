import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { db, getApp, logEvent, slugify, touch, APPS_DIR, PROFILE_DIR, ROOT, STATUSES, type Application } from "./db.ts";
import { resumeSize, ONE_PAGE } from "./ai.ts";
import { renderTex, contentHash, readTemplate, writeTemplate } from "./latex.ts";
import { listPrompts, savePrompt } from "./prompts.ts";
import { enqueue, listJobs, getJob, cancelJob, retryJob, resumeJob, resumeMatching, clearFinishedJobs } from "./queue.ts";
import { profileStatus, loadResume, saveResume, deleteResume, hasAnyResume, listResumes, DEFAULT_KEY } from "./profile.ts";
import { atsCheck } from "./ats.ts";
import { guardSettings, saveGuardSettings, modelStats, clearModelStats, resolveFallback, isUnreliable } from "./guard.ts";
import { printPage } from "./markdown.ts";
import { llmSettings, saveLlmSettings, saveTaskRoute, getStyle, saveStyle, PROVIDERS, authStatus, authRequired, setAuthPassword, type Provider, type Task, type StyleKind } from "./settings.ts";
import { listModels } from "./llm.ts";
import { stats, getGoals, saveGoals, checkAchievements, listAchievements, today } from "./goals.ts";
import { spawn } from "node:child_process";
import { HttpError, readJson, send } from "./http.ts";
import { LOGIN_PAGE, isAuthed, isPublicRoute, setSessionCookie, clearSessionCookie, attemptLogin } from "./auth.ts";
import { buildPdf, isLatexReady, letterHeader, writeJobFile, writeQuestionsFile } from "./documents.ts";
import { hostOf } from "./jobs.ts";
import { feedSettings, saveFeedSettings, feedLastRefresh, listFeed, getFeedItem, feedCounts, fetchBoard, unscoredIds, discoverBoard, markSeen, detectLang, AGGREGATORS, LEVELS, LEVEL_LABELS } from "./feed.ts";
import { preflight } from "./preflight.ts";
import { canonicalUrl } from "./scrape.ts";

const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? "0.0.0.0"; // reachable from your phone on the same Wi-Fi; set HOST=127.0.0.1 to keep it local-only
const PUBLIC = path.join(import.meta.dirname, "public");

/** Page text handed over by the bookmarklet, waiting for the app page to claim it. */
const pendingCaptures: { ts: number; url: string; title: string; text: string; resumed_job?: number; label?: string }[] = [];

// ---------- helpers ----------

function mustApp(id: string): Application {
  const app = getApp(Number(id));
  if (!app) throw new HttpError(404, "Application not found");
  return app;
}
function appDetail(app: Application) {
  const { source_text, fit_json, fit_all, ...rest } = app;
  return {
    ...rest,
    fit: fit_json ? JSON.parse(fit_json) : null,
    fit_all: fit_all ? JSON.parse(fit_all) : null,
    lang: detectLang(`${app.role} ${app.description ?? ""}`),
    resumes: listResumes().filter((x) => x.hasMarkdown).map(({ key, label }) => ({ key, label })),
    has_source_text: Boolean(source_text?.trim()),
    requirements: app.requirements ? JSON.parse(app.requirements) : [],
    documents: (db.prepare("SELECT id, kind, file, created_at, content, pages, pdf_hash, instructions, tex IS NOT NULL AS custom_tex, original IS NOT NULL AND original != content AS edited FROM documents WHERE application_id = ? ORDER BY id DESC").all(app.id) as any[])
      .map(({ pdf_hash, ...d }) => { const hash = contentHash(d.custom_tex ? (db.prepare("SELECT tex FROM documents WHERE id = ?").get(d.id) as any).tex : d.content); return { ...d, custom_tex: Boolean(d.custom_tex), edited: Boolean(d.edited), size: resumeSize(d.content), pdf_current: pdf_hash === hash, hash: hash.slice(0, 10) }; }),
    one_page: ONE_PAGE,
    latex: isLatexReady(),
    questions: db.prepare("SELECT * FROM questions WHERE application_id = ? ORDER BY id").all(app.id),
    events: db.prepare("SELECT * FROM events WHERE application_id = ? ORDER BY id DESC").all(app.id),
  };
}

/** An application that already covers this posting — same canonical URL, or the same company + role when those are given. */
function findDuplicate(url?: string | null, company?: string | null, role?: string | null) {
  const rows = db.prepare("SELECT id, company, role, status, url, applied_at, created_at FROM applications ORDER BY id DESC").all() as Pick<Application, "id" | "company" | "role" | "status" | "url" | "applied_at" | "created_at">[];
  const want = url?.trim() ? canonicalUrl(url) : null;
  const key = company?.trim() && role?.trim() ? `${company.trim().toLowerCase()}|${role.trim().toLowerCase()}` : null;
  return rows.find((a) => (want && a.url && canonicalUrl(a.url) === want) || (key && `${a.company.toLowerCase()}|${a.role.toLowerCase()}` === key)) ?? null;
}

// ---------- routes ----------

async function route(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url!, "http://x");
  const m = (method: string, pattern: RegExp) => (req.method === method ? pattern.exec(url.pathname) : null);
  let r: RegExpExecArray | null;

  // static
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return send(res, 200, fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8"), "text/html");
  if (req.method === "GET" && url.pathname === "/app.js") return send(res, 200, fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8"), "text/javascript");
  if (req.method === "GET" && url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }

  // Bookmarklet: run on a job page in your normal (logged-in) browser. It opens
  // the app and POSTs the rendered page text here; the app page then picks it
  // up. No scraping involved, so nothing gets blocked.
  if (m("GET", /^\/api\/bookmarklet$/)) {
    const origin = `http://${req.headers.host}`;
    const code =
      `(()=>{const m=document.querySelector('main,[role=main],article');const t=(m&&m.innerText.length>800?m:document.body).innerText;` +
      `const d={type:'jobtracker-capture',url:location.href,title:document.title,text:t.slice(0,60000)};` +
      `const p=fetch(${JSON.stringify(origin + "/api/captures")},{method:'POST',mode:'cors',keepalive:true,headers:{'content-type':'text/plain'},body:JSON.stringify(d)});` +
      `const w=window.open(${JSON.stringify(origin + "/?capture=wait")},'jobtracker');if(!w){alert('Pop-up blocked — allow pop-ups for this site and try again.');return;}` +
      `p.catch(()=>{const i=setInterval(()=>w.postMessage(d,${JSON.stringify(origin)}),400);addEventListener('message',e=>{if(e.data==='jobtracker-ack')clearInterval(i)});setTimeout(()=>clearInterval(i),30000);});})();`;
    return send(res, 200, { href: `javascript:${encodeURIComponent(code)}`, origin });
  }
  if (req.method === "OPTIONS" && url.pathname === "/api/captures") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" });
    return res.end();
  }
  if (m("POST", /^\/api\/captures$/)) {
    const body = await readJson(req);
    if (typeof body.text !== "string" || !body.text.trim()) throw new HttpError(400, "No page text");
    const url = String(body.url ?? ""), title = String(body.title ?? "");
    // If a task is parked on this site waiting for you to pass a check, this
    // page is what it was waiting for — resume it instead of starting over.
    const resumed = resumeMatching((need) => (need.type === "verify" && need.host && hostOf(url) === need.host ? { verified_text: body.text } : null));
    pendingCaptures.push({ ts: Date.now(), url, title, text: resumed ? "" : body.text, resumed_job: resumed?.id, label: resumed?.label });
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    return res.end(JSON.stringify({ ok: true, resumed: resumed?.id ?? null }));
  }
  if (m("GET", /^\/api\/captures\/latest$/)) {
    const cutoff = Date.now() - 2 * 60 * 1000;
    while (pendingCaptures.length && pendingCaptures[0].ts < cutoff) pendingCaptures.shift();
    return send(res, 200, pendingCaptures.shift() ?? null); // oldest first, so nothing is skipped
  }

  // Dashboard: recent activity across applications
  if (m("GET", /^\/api\/activity$/)) {
    const rows = db.prepare(`SELECT e.id, e.kind, e.detail, e.created_at, a.id AS application_id, a.company, a.role FROM events e JOIN applications a ON a.id = e.application_id
      WHERE e.kind NOT IN ('questions_found') ORDER BY e.id DESC LIMIT 12`).all();
    return send(res, 200, rows);
  }

  // Goals & achievements
  if (m("GET", /^\/api\/goals$/)) { checkAchievements(); return send(res, 200, { ...stats(), achievements: listAchievements() }); }
  if (m("PUT", /^\/api\/goals$/)) { saveGoals(await readJson(req)); return send(res, 200, { ...stats(), achievements: listAchievements() }); }

  // Model quality guard
  if (m("GET", /^\/api\/guard$/)) {
    const s = llmSettings();
    const routes = { default: { provider: s.provider, model: s.model }, ...Object.fromEntries(Object.entries(s.tasks).filter(([, r]) => r)) } as Record<string, { provider: Provider; model: string }>;
    return send(res, 200, {
      settings: guardSettings(), stats: modelStats(),
      auto: resolveFallback(routes.default),
      unreliable: Object.entries(routes).filter(([, r]) => isUnreliable(r)).map(([task, r]) => ({ task, ...r })),
    });
  }
  if (m("PUT", /^\/api\/guard$/)) { saveGuardSettings(await readJson(req)); return send(res, 200, { settings: guardSettings(), auto: resolveFallback({ provider: llmSettings().provider, model: llmSettings().model }) }); }
  if (m("DELETE", /^\/api\/guard\/stats$/)) { clearModelStats(); return send(res, 200, { ok: true }); }

  // Prompts
  if (m("GET", /^\/api\/prompts$/)) return send(res, 200, listPrompts());
  if ((r = m("PUT", /^\/api\/prompts\/(\w+)$/))) {
    const body = await readJson(req);
    savePrompt(r[1], body.reset ? null : String(body.text ?? ""));
    return send(res, 200, listPrompts());
  }

  // auth
  if (m("POST", /^\/api\/login$/)) {
    const { password } = await readJson(req);
    await attemptLogin(req.socket.remoteAddress ?? "?", password);
    setSessionCookie(res);
    return send(res, 200, { ok: true });
  }
  if (m("POST", /^\/api\/logout$/)) { clearSessionCookie(res); return send(res, 200, { ok: true }); }
  if (m("GET", /^\/api\/settings\/auth$/)) return send(res, 200, authStatus());
  if (m("PUT", /^\/api\/settings\/auth$/)) {
    const body = await readJson(req);
    const status = setAuthPassword(body.clear ? null : String(body.password ?? ""));
    if (!body.clear) setSessionCookie(res); // keep this browser logged in under the new password
    return send(res, 200, status);
  }

  // LLM settings
  // Every settings response has the same shape — the client swaps the whole object in.
  const settingsPayload = () => ({ ...llmSettings(), providers: PROVIDERS, latex: isLatexReady(), auth: authStatus() });
  if (m("GET", /^\/api\/settings$/)) return send(res, 200, settingsPayload());
  if (m("PUT", /^\/api\/settings$/)) { saveLlmSettings(await readJson(req)); return send(res, 200, settingsPayload()); }
  if ((r = m("PUT", /^\/api\/settings\/tasks\/(\w+)$/))) {
    const body = await readJson(req);
    saveTaskRoute(r[1] as Task, body.reset ? null : body);
    return send(res, 200, settingsPayload());
  }
  if (m("GET", /^\/api\/models$/)) {
    const provider = url.searchParams.get("provider") as Provider;
    if (!PROVIDERS.includes(provider)) throw new HttpError(400, "Unknown provider");
    return send(res, 200, await listModels(provider));
  }

  // profile
  if (m("GET", /^\/api\/profile$/)) return send(res, 200, profileStatus());
  if (m("POST", /^\/api\/profile\/import$/)) { const { key = DEFAULT_KEY } = await readJson(req); await preflight("import"); return send(res, 202, { job: enqueue("import", `Import resume${key === DEFAULT_KEY ? "" : ` (${key})`}`, { key }) }); }
  if (m("GET", /^\/api\/profile\/resume$/)) {
    const key = url.searchParams.get("key") || DEFAULT_KEY;
    if (!listResumes().some((r) => r.key === key && r.hasMarkdown)) throw new HttpError(404, "No such base resume yet — import one first");
    return send(res, 200, { key, markdown: await loadResume(key) });
  }
  // base resumes: create (optionally copying another), edit, delete
  if ((r = m("PUT", /^\/api\/profile\/resumes\/([\w.-]+)$/))) {
    const body = await readJson(req);
    const md = typeof body.markdown === "string" && body.markdown.trim() ? body.markdown : body.copyFrom ? await loadResume(String(body.copyFrom)) : null;
    if (!md) throw new HttpError(400, "Provide markdown, or copyFrom an existing base");
    const key = saveResume(r[1], md, body.label);
    return send(res, 200, { key, resumes: listResumes() });
  }
  if ((r = m("DELETE", /^\/api\/profile\/resumes\/([\w.-]+)$/))) {
    deleteResume(r[1]);
    db.prepare("UPDATE applications SET resume_key = NULL, resume_pinned = 0 WHERE resume_key = ?").run(r[1]);
    return send(res, 200, { resumes: listResumes() });
  }

  // jobs
  if (m("GET", /^\/api\/jobs$/)) return send(res, 200, listJobs());
  if ((r = m("GET", /^\/api\/jobs\/(\d+)$/))) { const j = getJob(Number(r[1])); if (!j) throw new HttpError(404, "Job not found"); return send(res, 200, j); }
  if ((r = m("POST", /^\/api\/jobs\/(\d+)\/cancel$/))) { const j = cancelJob(Number(r[1])); if (!j) throw new HttpError(404, "Job not found"); return send(res, 200, j); }
  if ((r = m("POST", /^\/api\/jobs\/(\d+)\/retry$/))) return send(res, 202, { job: retryJob(Number(r[1])) });
  if ((r = m("POST", /^\/api\/jobs\/(\d+)\/resume$/))) {
    const { text } = await readJson(req);
    const patch = typeof text === "string" && text.trim() ? { verified_text: text.trim() } : {};
    return send(res, 202, { job: resumeJob(Number(r[1]), patch) });
  }
  if (m("DELETE", /^\/api\/jobs$/)) { clearFinishedJobs(); return send(res, 200, { ok: true }); }

  // applications
  if (m("GET", /^\/api\/applications$/)) {
    const rows = db.prepare("SELECT id, company, role, location, status, applied_at, url, fit_score, fit_status, next_action_at, next_action, followed_up_at, created_at, updated_at FROM applications ORDER BY updated_at DESC").all() as any[];
    const t = today(), days = getGoals().followupDays;
    const ageDays = (d: string) => Math.floor((Date.parse(t) - Date.parse(d)) / 86_400_000);
    for (const a of rows) {
      // Due when a next action is dated today/earlier, or when an application has sat in
      // applied/screening for `followupDays` since the last touch without a reply.
      const last = [a.applied_at, a.followed_up_at].filter(Boolean).sort().pop();
      const stale = ["applied", "screening"].includes(a.status) && last && days > 0 && ageDays(last) >= days;
      a.due = a.next_action_at && a.next_action_at <= t ? "action" : stale ? "followup" : null;
      a.days_since = last ? ageDays(last) : null;
    }
    return send(res, 200, rows);
  }
  if (m("POST", /^\/api\/applications$/)) {
    const body = await readJson(req);
    if (!body.url && !body.description) throw new HttpError(400, "Provide a url or a description");
    // Same posting again? Say so instead of quietly making a second application (the client can force it).
    const dup = body.force ? null : findDuplicate(body.url, body.company, body.role);
    if (dup) return send(res, 409, { error: `You already track this posting: ${dup.company} · ${dup.role} (${dup.status}${dup.applied_at ? `, applied ${dup.applied_at}` : `, captured ${dup.created_at.slice(0, 10)}`}).`, existing: dup });
    await preflight("capture", "fit");
    const label = body.company || body.title ? `Capture — ${body.company || body.title}` : `Capture — ${body.url}`;
    const { force: _force, ...payload } = body;
    return send(res, 202, { job: enqueue("capture", label.slice(0, 80), payload) });
  }
  if ((r = m("GET", /^\/api\/applications\/(\d+)$/))) return send(res, 200, appDetail(mustApp(r[1])));
  if ((r = m("PATCH", /^\/api\/applications\/(\d+)$/))) {
    const app = mustApp(r[1]);
    const body = await readJson(req);
    const before = "status" in body || "applied_at" in body ? stats() : null;
    if ("resume_key" in body) {
      const key = String(body.resume_key ?? "");
      if (!listResumes().some((x) => x.key === key && x.hasMarkdown)) throw new HttpError(400, "Unknown base resume");
      const all = app.fit_all ? JSON.parse(app.fit_all) : {};
      const fit = all[key];
      db.prepare("UPDATE applications SET resume_key = ?, resume_pinned = 1, fit_score = COALESCE(?, fit_score), fit_json = COALESCE(?, fit_json) WHERE id = ?").run(key, fit?.score ?? null, fit ? JSON.stringify(fit) : null, app.id);
      logEvent(app.id, "edited", `Base resume set to “${listResumes().find((x) => x.key === key)?.label}”`);
    }
    const allowed = ["company", "role", "location", "url", "salary", "status", "applied_at", "notes", "description", "requirements", "next_action_at", "next_action"] as const;
    for (const k of allowed) {
      if (!(k in body)) continue;
      if (k === "status" && !STATUSES.includes(body.status)) throw new HttpError(400, "Bad status");
      if ((k === "company" || k === "role") && !String(body[k] ?? "").trim()) throw new HttpError(400, `${k} cannot be empty`);
      if ((k === "applied_at" || k === "next_action_at") && body[k] && !/^\d{4}-\d{2}-\d{2}$/.test(String(body[k]))) throw new HttpError(400, `${k} must be YYYY-MM-DD`);
      const value = k === "requirements" ? JSON.stringify(Array.isArray(body.requirements) ? body.requirements.map(String) : []) : body[k] === undefined ? null : body[k];
      db.prepare(`UPDATE applications SET ${k} = ? WHERE id = ?`).run(value, app.id);
      if (k === "description" && body.description !== app.description) db.prepare("UPDATE applications SET source_text = ? WHERE id = ?").run(body.description, app.id);
      if (k === "status" && body.status !== app.status) {
        logEvent(app.id, "status", `${app.status} → ${body.status}`);
        if (body.status === "applied" && !app.applied_at) db.prepare("UPDATE applications SET applied_at = date('now','localtime') WHERE id = ?").run(app.id);
      }
    }
    touch(app.id);
    const updated = getApp(app.id)!;
    if (["company", "role", "location", "url", "salary", "description", "requirements"].some((k) => k in body)) {
      writeJobFile(updated);
      logEvent(app.id, "edited", "Job details updated");
    }
    // Gamification: what did this change just achieve?
    let celebrate: { unlocked: ReturnType<typeof checkAchievements>; hits: string[]; streak: number } | null = null;
    if (before) {
      const after = stats();
      const hits = (["day", "week", "month"] as const).filter((k) => !before.periods[k].met && after.periods[k].met).map((k) => after.periods[k].label);
      celebrate = { unlocked: checkAchievements(after), hits, streak: after.streak };
    }
    return send(res, 200, { ...appDetail(updated), celebrate });
  }
  if ((r = m("DELETE", /^\/api\/applications\/(\d+)$/))) {
    const app = mustApp(r[1]);
    // Its queued work is pointless now; keep finished history rows for reference.
    db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = datetime('now') WHERE application_id = ? AND status = 'queued'").run(app.id);
    db.prepare("UPDATE feed_items SET status = 'new', application_id = NULL WHERE application_id = ?").run(app.id); // trackable again
    db.prepare("DELETE FROM applications WHERE id = ?").run(app.id);
    return send(res, 200, { ok: true, folder: app.folder }); // files on disk are left alone
  }

  // timeline: notes and follow-ups logged by hand
  if ((r = m("POST", /^\/api\/applications\/(\d+)\/events$/))) {
    const app = mustApp(r[1]);
    const { kind, detail } = await readJson(req);
    if (!["note", "followup", "interview", "call"].includes(kind)) throw new HttpError(400, "kind must be note, followup, interview or call");
    const text = String(detail ?? "").trim();
    if (kind === "note" && !text) throw new HttpError(400, "Note is empty");
    logEvent(app.id, kind, text || { followup: "Followed up", interview: "Interview", call: "Call" }[kind as string] || "");
    if (kind === "followup") db.prepare("UPDATE applications SET followed_up_at = ?, next_action_at = NULL, next_action = NULL WHERE id = ?").run(today(), app.id);
    touch(app.id);
    return send(res, 200, appDetail(getApp(app.id)!));
  }
  if ((r = m("DELETE", /^\/api\/events\/(\d+)$/))) {
    const ev = db.prepare("SELECT * FROM events WHERE id = ?").get(Number(r[1])) as any;
    if (!ev) throw new HttpError(404, "Event not found");
    if (!["note", "followup", "interview", "call"].includes(ev.kind)) throw new HttpError(400, "Only hand-logged entries can be removed");
    db.prepare("DELETE FROM events WHERE id = ?").run(ev.id);
    return send(res, 200, appDetail(getApp(ev.application_id)!));
  }
  if ((r = m("POST", /^\/api\/applications\/(\d+)\/translate$/))) {
    const app = mustApp(r[1]);
    await preflight("translate");
    return send(res, 202, { job: enqueue("translate", `Translate — ${app.company}`, {}, app.id) });
  }
  if ((r = m("POST", /^\/api\/applications\/(\d+)\/prep$/))) {
    const app = mustApp(r[1]);
    if (!hasAnyResume()) throw new HttpError(400, "Import your resume first");
    await preflight("prep");
    return send(res, 202, { job: enqueue("prep", `Interview prep — ${app.company}`, {}, app.id) });
  }

  // job feed
  if (m("GET", /^\/api\/feed$/)) {
    const status = url.searchParams.get("status");
    const items = listFeed(status && status !== "open" ? status : null) as any[];
    const payload = { items, settings: feedSettings(), aggregators: AGGREGATORS, levels: LEVELS.map((l) => ({ key: l, label: LEVEL_LABELS[l] })), lastRefresh: feedLastRefresh(), counts: feedCounts() };
    if (url.searchParams.get("seen") === "1") markSeen(items.filter((i) => !i.seen).map((i) => i.id)); // viewing the list clears "new"
    return send(res, 200, payload);
  }
  if (m("POST", /^\/api\/feed\/discover$/)) {
    const { input } = await readJson(req);
    const found = await discoverBoard(String(input ?? ""));
    if (!found) return send(res, 200, { ok: false, error: "No Greenhouse / Lever / Ashby / Workable / SmartRecruiters board found there. Try the company's careers page URL, or the board id directly (greenhouse:<token>)." });
    try { const jobs = await fetchBoard(found.board); return send(res, 200, { ok: true, board: found.board, via: found.via, guessed: found.via.startsWith("guessed"), count: jobs.length, sample: jobs.slice(0, 3).map((j) => j.title) }); }
    catch (e: any) { return send(res, 200, { ok: false, board: found.board, error: `Found ${found.board} but it didn't respond: ${e.message}` }); }
  }
  if (m("POST", /^\/api\/feed\/bulk$/)) {
    const { action, below } = await readJson(req);
    const s = feedSettings();
    if (action === "dismiss_low") { const n = Number(db.prepare("UPDATE feed_items SET status = 'dismissed' WHERE status = 'new' AND fit_score IS NOT NULL AND fit_score < ?").run(Number(below ?? s.minScore)).changes); return send(res, 200, { ok: true, n }); }
    if (action === "dismiss_screened") { const n = Number(db.prepare("UPDATE feed_items SET status = 'dismissed' WHERE status = 'new' AND fit_score IS NULL AND ats_pct IS NOT NULL AND ats_pct < ?").run(s.minAts).changes); return send(res, 200, { ok: true, n }); }
    if (action === "track_hot") {
      const hot = db.prepare("SELECT * FROM feed_items WHERE status = 'new' AND fit_score >= ? ORDER BY fit_score DESC, ats_pct DESC LIMIT 20").all(s.minScore) as any[];
      if (hot.length) await preflight("capture", "fit");
      for (const it of hot) enqueue("capture", `Capture — ${it.company}`, it.description?.trim() ? { url: it.url, company: it.company, role: it.title, title: `${it.title} — ${it.company}`, description: `${it.location ? `Location: ${it.location}\n` : ""}${it.salary ? `Salary: ${it.salary}\n` : ""}\n${it.description}`, feed_item_id: it.id } : { url: it.url, feed_item_id: it.id });
      return send(res, 200, { ok: true, n: hot.length });
    }
    throw new HttpError(400, "Unknown bulk action");
  }
  if (m("PUT", /^\/api\/feed\/settings$/)) { saveFeedSettings(await readJson(req)); return send(res, 200, { settings: feedSettings(), counts: feedCounts() }); }
  if (m("POST", /^\/api\/feed\/refresh$/)) { await preflight("feed"); return send(res, 202, { job: enqueue("feed_refresh", "Refresh job feed", {}) }); }
  if (m("POST", /^\/api\/feed\/score$/)) {
    const body = await readJson(req);
    const ids: number[] = Array.isArray(body.ids) && body.ids.length ? body.ids.map(Number) : unscoredIds(feedSettings().scorePerRefresh);
    if (!ids.length) throw new HttpError(400, "Nothing to score");
    if (!hasAnyResume()) throw new HttpError(400, "Import your resume first");
    await preflight("feed");
    return send(res, 202, { job: enqueue("feed_score", `Score ${ids.length} feed posting${ids.length === 1 ? "" : "s"}`, { ids }) });
  }
  if (m("POST", /^\/api\/feed\/test$/)) {
    const { board } = await readJson(req);
    const b = String(board ?? "").trim().toLowerCase().replace(/\s+/g, "");
    if (!/^(greenhouse|lever|ashby|workable|smartrecruiters):[\w.-]+$/.test(b)) throw new HttpError(400, "Use provider:token, e.g. greenhouse:stripe");
    try { const jobs = await fetchBoard(b); return send(res, 200, { ok: true, count: jobs.length, sample: jobs.slice(0, 3).map((j) => j.title) }); }
    catch (e: any) { return send(res, 200, { ok: false, error: e.message }); }
  }
  if ((r = m("POST", /^\/api\/feed\/(\d+)\/(track|dismiss|restore|delete)$/))) {
    const it = getFeedItem(Number(r[1]));
    if (!it) throw new HttpError(404, "Feed item not found");
    if (r[2] === "dismiss") { db.prepare("UPDATE feed_items SET status = 'dismissed' WHERE id = ?").run(it.id); return send(res, 200, { ok: true }); }
    if (r[2] === "delete") { db.prepare("DELETE FROM feed_items WHERE id = ?").run(it.id); return send(res, 200, { ok: true }); }
    if (r[2] === "restore") { db.prepare("UPDATE feed_items SET status = 'new' WHERE id = ?").run(it.id); return send(res, 200, { ok: true }); }
    if (it.status === "tracked" && it.application_id) return send(res, 200, { application_id: it.application_id });
    const dup = findDuplicate(it.url, it.company, it.title_en || it.title);
    if (dup) { // captured by hand earlier — just link the feed item to it
      db.prepare("UPDATE feed_items SET status = 'tracked', application_id = ? WHERE id = ?").run(dup.id, it.id);
      return send(res, 200, { application_id: dup.id, existing: dup });
    }
    await preflight("capture", "fit");
    const body = it.description?.trim()
      ? { url: it.url, company: it.company, role: it.title_en || it.title, title: `${it.title_en || it.title} — ${it.company}`, description: `${it.location ? `Location: ${it.location}\n` : ""}${it.salary ? `Salary: ${it.salary}\n` : ""}\n${it.description}`, feed_item_id: it.id }
      : { url: it.url, feed_item_id: it.id }; // no text from the API → fetch the page
    return send(res, 202, { job: enqueue("capture", `Capture — ${it.company}`, body) });
  }
  if (m("DELETE", /^\/api\/feed\/dismissed$/)) { db.prepare("DELETE FROM feed_items WHERE status = 'dismissed'").run(); return send(res, 200, { ok: true }); }

  // export / backup
  if (m("GET", /^\/api\/export\/applications\.csv$/)) {
    const rows = db.prepare("SELECT id, company, role, location, salary, status, applied_at, fit_score, url, next_action_at, next_action, followed_up_at, notes, created_at FROM applications ORDER BY id").all() as any[];
    const cols = Object.keys(rows[0] ?? { id: 1, company: "", role: "" });
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...rows.map((row) => cols.map((c) => cell(row[c])).join(","))].join("\n");
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="applications-${today()}.csv"` });
    return res.end("\ufeff" + csv);
  }
  if (m("GET", /^\/api\/export\/backup$/)) {
    // Everything needed to restore: database (+ WAL), per-application files, base resume, templates, secret key.
    const parts = ["data", "applications", "profile", "templates"].filter((d) => fs.existsSync(path.join(ROOT, d)));
    res.writeHead(200, { "content-type": "application/gzip", "content-disposition": `attachment; filename="job-tracker-backup-${today()}.tar.gz"` });
    const tar = spawn("tar", ["-czf", "-", "-C", ROOT, ...parts], { stdio: ["ignore", "pipe", "inherit"] }); // spawn: raw bytes, no utf8 decoding
    tar.stdout.pipe(res);
    tar.on("error", () => res.end());
    return;
  }

  if ((r = m("POST", /^\/api\/applications\/(\d+)\/reextract$/))) {
    const app = mustApp(r[1]);
    const { source = "description" } = await readJson(req);
    if (source === "url" && !app.url) throw new HttpError(400, "This application has no posting URL");
    await preflight("capture");
    return send(res, 202, { job: enqueue("reextract", `${source === "url" ? "Fetch again" : "Re-extract"} — ${app.company}`, { source }, app.id) });
  }
  if ((r = m("POST", /^\/api\/applications\/(\d+)\/fit$/))) {
    const app = mustApp(r[1]);
    if (!hasAnyResume()) throw new HttpError(400, "Import your resume first");
    await preflight("fit");
    return send(res, 202, { job: enqueue("fit", `Fit score — ${app.company}`, {}, app.id) });
  }
  if ((r = m("POST", /^\/api\/applications\/(\d+)\/generate$/))) {
    const app = mustApp(r[1]);
    const body = await readJson(req);
    const what = body.what ?? "both";
    const names: Record<string, string> = { resume: "Tailored resume", cover_letter: "Cover letter", both: "Resume + cover letter" };
    if (!names[what]) throw new HttpError(400, "Bad 'what'");
    const emphasize = Array.isArray(body.emphasize) ? body.emphasize.map(String).slice(0, 25) : [];
    const instructions = String(body.instructions ?? "").trim().slice(0, 1000);
    const tag = emphasize.length ? " (ATS terms)" : instructions ? " (with your notes)" : "";
    await preflight(...(what === "resume" ? ["resume" as const] : what === "cover_letter" ? ["cover_letter" as const] : ["resume" as const, "cover_letter" as const]));
    return send(res, 202, { job: enqueue("generate", `${names[what]}${tag} — ${app.company}`, { what, emphasize, instructions }, app.id) });
  }
  // Apply pack: make sure the current PDFs are on disk, then show the application folder in Finder.
  if ((r = m("POST", /^\/api\/applications\/(\d+)\/reveal$/))) {
    const app = mustApp(r[1]);
    const dir = path.join(APPS_DIR, app.folder!);
    fs.mkdirSync(dir, { recursive: true });
    if (isLatexReady()) {
      for (const kind of ["resume", "cover_letter"]) {
        const doc = db.prepare("SELECT id FROM documents WHERE application_id = ? AND kind = ? ORDER BY id DESC LIMIT 1").get(app.id, kind) as { id: number } | undefined;
        if (doc) await buildPdf(doc.id).catch((e) => console.error("PDF build failed:", e.message));
      }
    }
    if (db.prepare("SELECT 1 FROM questions WHERE application_id = ? LIMIT 1").get(app.id)) writeQuestionsFile(app);
    const files = fs.readdirSync(dir).filter((f) => !f.startsWith(".")).sort();
    if (process.platform === "darwin") spawn("open", [dir], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
    return send(res, 200, { ok: process.platform === "darwin", path: dir, files });
  }
  // ATS keyword check: deterministic comparison of a document (or a base resume) with the posting
  if ((r = m("GET", /^\/api\/applications\/(\d+)\/ats$/))) {
    const app = mustApp(r[1]);
    const docParam = url.searchParams.get("doc") ?? "latest";
    let text: string, label: string;
    if (docParam === "base") { text = await loadResume(app.resume_key ?? undefined); label = "base resume"; }
    else {
      const doc = docParam === "latest"
        ? db.prepare("SELECT * FROM documents WHERE application_id = ? AND kind = 'resume' ORDER BY id DESC LIMIT 1").get(app.id) as any
        : db.prepare("SELECT * FROM documents WHERE id = ? AND application_id = ?").get(Number(docParam), app.id) as any;
      if (!doc) { text = await loadResume(app.resume_key ?? undefined); label = "base resume"; }
      else { text = doc.content; label = `resume v${(db.prepare("SELECT COUNT(*) AS n FROM documents WHERE application_id = ? AND kind = 'resume' AND id <= ?").get(app.id, doc.id) as any).n}`; }
    }
    return send(res, 200, { label, ...atsCheck(app.description ?? "", app.requirements ? JSON.parse(app.requirements) : [], text) });
  }
  if ((r = m("PUT", /^\/api\/documents\/(\d+)$/))) {
    const { content } = await readJson(req);
    if (typeof content !== "string" || !content.trim()) throw new HttpError(400, "Document content is empty");
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(r[1])) as any;
    if (!doc) throw new HttpError(404, "Document not found");
    db.prepare("UPDATE documents SET content = ?, tex = NULL WHERE id = ?").run(content, doc.id);
    if (doc.file) fs.writeFileSync(path.join(ROOT, doc.file), content);
    touch(doc.application_id);
    let pdfError: string | null = null;
    if (isLatexReady()) await buildPdf(doc.id).catch((e) => { pdfError = e.message; });
    return send(res, 200, { ok: true, pdfError, texReset: doc.tex !== null });
  }
  // hand-editable LaTeX per document
  if ((r = m("GET", /^\/api\/documents\/(\d+)\/tex$/))) {
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(r[1])) as any;
    if (!doc) throw new HttpError(404, "Document not found");
    return send(res, 200, { tex: doc.tex ?? renderTex(doc.content, doc.kind, doc.kind === "cover_letter" ? await letterHeader() : undefined), custom: doc.tex !== null });
  }
  if ((r = m("PUT", /^\/api\/documents\/(\d+)\/tex$/))) {
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(r[1])) as any;
    if (!doc) throw new HttpError(404, "Document not found");
    const body = await readJson(req);
    if (!body.reset && (typeof body.tex !== "string" || !body.tex.includes("\\begin{document}"))) throw new HttpError(400, "That doesn't look like a complete LaTeX document");
    db.prepare("UPDATE documents SET tex = ? WHERE id = ?").run(body.reset ? null : body.tex, doc.id);
    touch(doc.application_id);
    const built = await buildPdf(doc.id).catch((e) => ({ error: e.message as string }));
    return send(res, 200, "error" in built ? { ok: false, error: built.error } : { ok: true, pages: built.pages });
  }
  if ((r = m("POST", /^\/api\/documents\/(\d+)\/condense$/))) {
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(r[1])) as any;
    if (!doc || doc.kind !== "resume") throw new HttpError(404, "Resume not found");
    const app = mustApp(String(doc.application_id));
    await preflight("resume");
    return send(res, 202, { job: enqueue("condense", `Condense resume — ${app.company}`, { document_id: doc.id }, app.id) });
  }
  if ((r = m("POST", /^\/api\/documents\/(\d+)\/learn$/))) {
    const doc = db.prepare("SELECT d.*, a.company FROM documents d JOIN applications a ON a.id = d.application_id WHERE d.id = ?").get(Number(r[1])) as any;
    if (!doc) throw new HttpError(404, "Document not found");
    if (!doc.original || doc.original === doc.content) throw new HttpError(400, "No manual edits on this version yet — edit the Markdown, save, then learn.");
    await preflight("learn");
    return send(res, 202, { job: enqueue("learn", `Learn ${doc.kind === "resume" ? "resume" : "cover letter"} format — ${doc.company}`, { document_id: doc.id }, doc.application_id) });
  }
  // learned formatting preferences
  if (m("GET", /^\/api\/style$/)) return send(res, 200, { resume: getStyle("resume"), cover_letter: getStyle("cover_letter") });
  if ((r = m("PUT", /^\/api\/style\/(resume|cover_letter)$/))) {
    const body = await readJson(req);
    saveStyle(r[1] as StyleKind, body.reset ? null : String(body.text ?? ""));
    return send(res, 200, { resume: getStyle("resume"), cover_letter: getStyle("cover_letter") });
  }
  // PDF templates (global)
  if (m("GET", /^\/api\/templates$/)) {
    return send(res, 200, {
      resume: { text: readTemplate("resume"), custom: readTemplate("resume") !== readTemplate("resume", true) },
      cover_letter: { text: readTemplate("cover_letter"), custom: readTemplate("cover_letter") !== readTemplate("cover_letter", true) },
    });
  }
  if ((r = m("PUT", /^\/api\/templates\/(resume|cover_letter)$/))) {
    const body = await readJson(req);
    writeTemplate(r[1] as "resume" | "cover_letter", body.reset ? null : String(body.text ?? ""));
    db.prepare("UPDATE documents SET pdf_hash = NULL WHERE kind = ?").run(r[1]); // force rebuilds
    return send(res, 200, { ok: true });
  }
  if ((r = m("GET", /^\/doc\/(\d+)\.pdf$/))) {
    const { pdf } = await buildPdf(Number(r[1]));
    const doc = db.prepare("SELECT d.kind, a.company FROM documents d JOIN applications a ON a.id = d.application_id WHERE d.id = ?").get(Number(r[1])) as any;
    const name = `${slugify(doc.company)}-${doc.kind === "resume" ? "resume" : "cover-letter"}.pdf`;
    res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"`, "cache-control": "no-store" });
    return res.end(pdf);
  }
  if ((r = m("GET", /^\/doc\/(\d+)\.tex$/))) {
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(r[1])) as any;
    if (!doc) throw new HttpError(404, "Document not found");
    return send(res, 200, renderTex(doc.content, doc.kind, doc.kind === "cover_letter" ? await letterHeader() : undefined), "text/plain; charset=utf-8");
  }
  if ((r = m("GET", /^\/doc\/(\d+)$/))) {
    const doc = db.prepare("SELECT d.*, a.company, a.role FROM documents d JOIN applications a ON a.id = d.application_id WHERE d.id = ?").get(Number(r[1])) as any;
    if (!doc) throw new HttpError(404, "Document not found");
    return send(res, 200, printPage(`${doc.kind === "resume" ? "Resume" : "Cover letter"} — ${doc.company}`, doc.content, doc.kind), "text/html");
  }

  // questions
  if ((r = m("POST", /^\/api\/applications\/(\d+)\/questions$/))) {
    const app = mustApp(r[1]);
    const { questions } = await readJson(req) as { questions: string[] };
    const qs = (questions ?? []).map((q) => q.trim()).filter(Boolean);
    if (!qs.length) throw new HttpError(400, "No questions");
    await preflight("questions");
    return send(res, 202, { job: enqueue("questions", `Answers (${qs.length}) — ${app.company}`, { questions: qs }, app.id) });
  }
  if ((r = m("PUT", /^\/api\/questions\/(\d+)$/))) {
    const { answer } = await readJson(req);
    const q = db.prepare("SELECT * FROM questions WHERE id = ?").get(Number(r[1])) as any;
    if (!q) throw new HttpError(404, "Question not found");
    db.prepare("UPDATE questions SET answer = ? WHERE id = ?").run(answer, q.id);
    writeQuestionsFile(getApp(q.application_id)!);
    return send(res, 200, { ok: true });
  }
  if ((r = m("DELETE", /^\/api\/questions\/(\d+)$/))) {
    const q = db.prepare("SELECT * FROM questions WHERE id = ?").get(Number(r[1])) as any;
    if (q) { db.prepare("DELETE FROM questions WHERE id = ?").run(q.id); writeQuestionsFile(getApp(q.application_id)!); }
    return send(res, 200, { ok: true });
  }
  if (m("GET", /^\/api\/qa-bank$/)) {
    const q = `%${url.searchParams.get("q") ?? ""}%`;
    return send(res, 200, db.prepare("SELECT q.*, a.company, a.role FROM questions q JOIN applications a ON a.id = q.application_id WHERE q.question LIKE ? OR q.answer LIKE ? ORDER BY q.id DESC LIMIT 100").all(q, q));
  }

  throw new HttpError(404, "Not found");
}

http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url!, "http://x").pathname;
    if (!isPublicRoute(req.method, pathname) && !isAuthed(req)) {
      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) return send(res, 200, LOGIN_PAGE, "text/html");
      throw new HttpError(401, "Authentication required");
    }
    await route(req, res);
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    const msg = /authentication method|x-api-key|authentication_error/i.test(e.message ?? "")
      ? "No Anthropic API key. Add one in ⚙ Settings (or ANTHROPIC_API_KEY in .env), or switch provider."
      : e.message ?? String(e);
    send(res, status, { error: msg });
  }
}).listen(PORT, HOST, () => {
  // Feed auto-refresh: check every 15 minutes whether the configured interval has elapsed.
  setInterval(() => {
    const h = feedSettings().autoHours;
    if (!h) return;
    const last = feedLastRefresh();
    if (!last || Date.now() - Date.parse(last) >= h * 3_600_000) enqueue("feed_refresh", "Refresh job feed (auto)", {});
  }, 15 * 60 * 1000).unref();
  console.log(`Job Tracker → http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") {
    for (const ifs of Object.values(os.networkInterfaces())) {
      for (const i of ifs ?? []) if (i.family === "IPv4" && !i.internal) console.log(`  on your phone → http://${i.address}:${PORT}`);
    }
    if (!authRequired()) console.log("  ⚠ No password set — anyone on your network can open this app. Set AUTH_PASSWORD in .env, or add one in ⚙ Settings → Security.");
  }
});
