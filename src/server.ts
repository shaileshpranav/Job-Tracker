import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { db, getApp, logEvent, slugify, touch, PROFILE_DIR, ROOT, STATUSES, type Application } from "./db.ts";
import { resumeSize, ONE_PAGE } from "./ai.ts";
import { renderTex, contentHash, readTemplate, writeTemplate } from "./latex.ts";
import { listPrompts, savePrompt } from "./prompts.ts";
import { enqueue, listJobs, getJob, cancelJob, retryJob, resumeJob, resumeMatching, clearFinishedJobs } from "./queue.ts";
import { profileStatus } from "./profile.ts";
import { printPage } from "./markdown.ts";
import { llmSettings, saveLlmSettings, saveTaskRoute, getStyle, saveStyle, PROVIDERS, authStatus, authRequired, setAuthPassword, type Provider, type Task, type StyleKind } from "./settings.ts";
import { listModels } from "./llm.ts";
import { stats, saveGoals, checkAchievements, listAchievements } from "./goals.ts";
import { HttpError, readJson, send } from "./http.ts";
import { LOGIN_PAGE, isAuthed, isPublicRoute, setSessionCookie, clearSessionCookie, attemptLogin } from "./auth.ts";
import { buildPdf, isLatexReady, letterHeader, writeJobFile, writeQuestionsFile } from "./documents.ts";
import { hostOf } from "./jobs.ts";

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
  const { source_text, fit_json, ...rest } = app;
  return {
    ...rest,
    fit: fit_json ? JSON.parse(fit_json) : null,
    has_source_text: Boolean(source_text?.trim()),
    requirements: app.requirements ? JSON.parse(app.requirements) : [],
    documents: (db.prepare("SELECT id, kind, file, created_at, content, pages, pdf_hash, tex IS NOT NULL AS custom_tex, original IS NOT NULL AND original != content AS edited FROM documents WHERE application_id = ? ORDER BY id DESC").all(app.id) as any[])
      .map(({ pdf_hash, ...d }) => ({ ...d, custom_tex: Boolean(d.custom_tex), edited: Boolean(d.edited), size: resumeSize(d.content), pdf_current: pdf_hash === contentHash(d.custom_tex ? (db.prepare("SELECT tex FROM documents WHERE id = ?").get(d.id) as any).tex : d.content) })),
    one_page: ONE_PAGE,
    latex: isLatexReady(),
    questions: db.prepare("SELECT * FROM questions WHERE application_id = ? ORDER BY id").all(app.id),
    events: db.prepare("SELECT * FROM events WHERE application_id = ? ORDER BY id DESC").all(app.id),
  };
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

  // Goals & achievements
  if (m("GET", /^\/api\/goals$/)) { checkAchievements(); return send(res, 200, { ...stats(), achievements: listAchievements() }); }
  if (m("PUT", /^\/api\/goals$/)) { saveGoals(await readJson(req)); return send(res, 200, { ...stats(), achievements: listAchievements() }); }

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
  if (m("GET", /^\/api\/settings$/)) return send(res, 200, { ...llmSettings(), providers: PROVIDERS, latex: isLatexReady(), auth: authStatus() });
  if (m("PUT", /^\/api\/settings$/)) return send(res, 200, { ...saveLlmSettings(await readJson(req)), providers: PROVIDERS, latex: isLatexReady(), auth: authStatus() });
  if ((r = m("PUT", /^\/api\/settings\/tasks\/(\w+)$/))) {
    const body = await readJson(req);
    return send(res, 200, { ...saveTaskRoute(r[1] as Task, body.reset ? null : body), providers: PROVIDERS });
  }
  if (m("GET", /^\/api\/models$/)) {
    const provider = url.searchParams.get("provider") as Provider;
    if (!PROVIDERS.includes(provider)) throw new HttpError(400, "Unknown provider");
    return send(res, 200, await listModels(provider));
  }

  // profile
  if (m("GET", /^\/api\/profile$/)) return send(res, 200, profileStatus());
  if (m("POST", /^\/api\/profile\/import$/)) return send(res, 202, { job: enqueue("import", "Import resume") });

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
    const rows = db.prepare("SELECT id, company, role, location, status, applied_at, url, fit_score, fit_status, created_at, updated_at FROM applications ORDER BY updated_at DESC").all();
    return send(res, 200, rows);
  }
  if (m("POST", /^\/api\/applications$/)) {
    const body = await readJson(req);
    if (!body.url && !body.description) throw new HttpError(400, "Provide a url or a description");
    const label = body.company || body.title ? `Capture — ${body.company || body.title}` : `Capture — ${body.url}`;
    return send(res, 202, { job: enqueue("capture", label.slice(0, 80), body) });
  }
  if ((r = m("GET", /^\/api\/applications\/(\d+)$/))) return send(res, 200, appDetail(mustApp(r[1])));
  if ((r = m("PATCH", /^\/api\/applications\/(\d+)$/))) {
    const app = mustApp(r[1]);
    const body = await readJson(req);
    const before = "status" in body || "applied_at" in body ? stats() : null;
    const allowed = ["company", "role", "location", "url", "salary", "status", "applied_at", "notes", "description", "requirements"] as const;
    for (const k of allowed) {
      if (!(k in body)) continue;
      if (k === "status" && !STATUSES.includes(body.status)) throw new HttpError(400, "Bad status");
      if ((k === "company" || k === "role") && !String(body[k] ?? "").trim()) throw new HttpError(400, `${k} cannot be empty`);
      if (k === "applied_at" && body.applied_at && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.applied_at))) throw new HttpError(400, "applied_at must be YYYY-MM-DD");
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
    db.prepare("DELETE FROM applications WHERE id = ?").run(app.id);
    return send(res, 200, { ok: true, folder: app.folder }); // files on disk are left alone
  }

  if ((r = m("POST", /^\/api\/applications\/(\d+)\/reextract$/))) {
    const app = mustApp(r[1]);
    const { source = "description" } = await readJson(req);
    if (source === "url" && !app.url) throw new HttpError(400, "This application has no posting URL");
    return send(res, 202, { job: enqueue("reextract", `${source === "url" ? "Fetch again" : "Re-extract"} — ${app.company}`, { source }, app.id) });
  }
  if ((r = m("POST", /^\/api\/applications\/(\d+)\/fit$/))) {
    const app = mustApp(r[1]);
    if (!fs.existsSync(path.join(PROFILE_DIR, "resume.md"))) throw new HttpError(400, "Import your resume first");
    return send(res, 202, { job: enqueue("fit", `Fit score — ${app.company}`, {}, app.id) });
  }
  if ((r = m("POST", /^\/api\/applications\/(\d+)\/generate$/))) {
    const app = mustApp(r[1]);
    const { what = "both" } = await readJson(req);
    const names: Record<string, string> = { resume: "Tailored resume", cover_letter: "Cover letter", both: "Resume + cover letter" };
    if (!names[what]) throw new HttpError(400, "Bad 'what'");
    return send(res, 202, { job: enqueue("generate", `${names[what]} — ${app.company}`, { what }, app.id) });
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
    return send(res, 202, { job: enqueue("condense", `Condense resume — ${app.company}`, { document_id: doc.id }, app.id) });
  }
  if ((r = m("POST", /^\/api\/documents\/(\d+)\/learn$/))) {
    const doc = db.prepare("SELECT d.*, a.company FROM documents d JOIN applications a ON a.id = d.application_id WHERE d.id = ?").get(Number(r[1])) as any;
    if (!doc) throw new HttpError(404, "Document not found");
    if (!doc.original || doc.original === doc.content) throw new HttpError(400, "No manual edits on this version yet — edit the Markdown, save, then learn.");
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
  console.log(`Job Tracker → http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") {
    for (const ifs of Object.values(os.networkInterfaces())) {
      for (const i of ifs ?? []) if (i.family === "IPv4" && !i.internal) console.log(`  on your phone → http://${i.address}:${PORT}`);
    }
    if (!authRequired()) console.log("  ⚠ No password set — anyone on your network can open this app. Set AUTH_PASSWORD in .env, or add one in ⚙ Settings → Security.");
  }
});
