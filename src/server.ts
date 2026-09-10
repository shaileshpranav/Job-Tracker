import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { db, getApp, logEvent, saveDocument, slugify, touch, APPS_DIR, PROFILE_DIR, ROOT, STATUSES, type Application } from "./db.ts";
import { captureFromUrl } from "./scrape.ts";
import { extractJob, tailorResume, condenseResume, looksTooLong, writeCoverLetter, answerQuestions, scoreFit, learnStyle, resumeSize, ONE_PAGE, type JobExtract } from "./ai.ts";
import { compilePdf, compileTex, latexAvailable, renderTex, markdownToTex, contentHash, readTemplate, writeTemplate } from "./latex.ts";
import { listPrompts, savePrompt } from "./prompts.ts";
import { registerJob, enqueue, listJobs, getJob, cancelJob, retryJob, clearFinishedJobs, type Progress } from "./queue.ts";
import { loadResume, loadNotes, profileStatus } from "./profile.ts";
import { printPage } from "./markdown.ts";
import { llmSettings, saveLlmSettings, saveTaskRoute, getStyle, saveStyle, PROVIDERS, type Provider, type Task, type StyleKind } from "./settings.ts";
import { listModels } from "./llm.ts";

const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? "0.0.0.0"; // reachable from your phone on the same Wi-Fi; set HOST=127.0.0.1 to keep it local-only
const PUBLIC = path.join(import.meta.dirname, "public");

/** Page text handed over by the bookmarklet, waiting for the app page to claim it. */
const pendingCaptures: { ts: number; url: string; title: string; text: string }[] = [];

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

// ---------- helpers ----------

const MAX_BODY = 8 * 1024 * 1024;
async function readJson(req: http.IncomingMessage): Promise<any> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new HttpError(413, "Request body too large");
  }
  if (!body.trim()) return {};
  try { return JSON.parse(body); } catch { throw new HttpError(400, "Body is not valid JSON"); }
}
function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : (body as string));
}
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
    latex: latexReady,
    questions: db.prepare("SELECT * FROM questions WHERE application_id = ? ORDER BY id").all(app.id),
    events: db.prepare("SELECT * FROM events WHERE application_id = ? ORDER BY id DESC").all(app.id),
  };
}

function createApplication(job: JobExtract, url: string | null, sourceText: string): Application {
  const info = db.prepare(
    `INSERT INTO applications (company, role, location, url, salary, description, requirements, source_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(job.company, job.role, job.location || null, url, job.salary || null, job.description, JSON.stringify(job.requirements), sourceText);
  const id = Number(info.lastInsertRowid);
  const folder = `${String(id).padStart(3, "0")}-${slugify(job.company)}-${slugify(job.role)}`;
  db.prepare("UPDATE applications SET folder = ? WHERE id = ?").run(folder, id);
  fs.mkdirSync(path.join(APPS_DIR, folder), { recursive: true });
  writeJobFile(getApp(id)!);
  logEvent(id, "created", url ? `Captured from ${url}` : "Entered manually");
  if (job.application_questions.length) {
    logEvent(id, "questions_found", job.application_questions.join("\n"));
  }
  return getApp(id)!;
}

let latexReady = false;
latexAvailable().then((ok) => { latexReady = ok; console.log(ok ? "LaTeX found → PDF export enabled" : "LaTeX not found → PDF export uses browser print"); });

/** Name/contact header for cover letters, taken from the base resume. */
async function letterHeader() {
  try { const { name, contact } = markdownToTex(await loadResume()); return { name, contact }; } catch { return undefined; }
}

/** Compile a document to PDF, cache it next to the Markdown, record the page count. */
async function buildPdf(docId: number) {
  const doc = db.prepare("SELECT d.*, a.folder FROM documents d JOIN applications a ON a.id = d.application_id WHERE d.id = ?").get(docId) as any;
  if (!doc) throw new HttpError(404, "Document not found");
  const hash = contentHash(doc.tex ?? doc.content);
  const pdfPath = path.join(APPS_DIR, doc.folder, doc.kind === "resume" ? "resume.pdf" : "cover-letter.pdf");
  if (doc.pdf_hash === hash && fs.existsSync(pdfPath)) return { pdf: fs.readFileSync(pdfPath), pages: doc.pages as number };
  const r = doc.tex ? await compileTex(doc.tex) : await compilePdf(doc.content, doc.kind, doc.kind === "cover_letter" ? await letterHeader() : undefined);
  fs.writeFileSync(path.join(APPS_DIR, doc.folder, doc.kind === "resume" ? "resume.tex" : "cover-letter.tex"), r.tex);
  fs.writeFileSync(pdfPath, r.pdf);
  db.prepare("UPDATE documents SET pages = ?, pdf = ?, pdf_hash = ? WHERE id = ?").run(r.pages, path.relative(ROOT, pdfPath), hash, doc.id);
  return { pdf: r.pdf, pages: r.pages };
}

function fitInBackground(appId: number) {
  if (!fs.existsSync(path.join(PROFILE_DIR, "resume.md"))) return; // nothing to compare against yet
  const app = getApp(appId)!;
  enqueue("fit", `Fit score — ${app.company}`, {}, appId);
}

// ---------- job handlers (the actual work; routes only enqueue) ----------

registerJob("capture", async (body, _job, progress) => {
  let job: JobExtract, sourceText: string;
  if (body.url && !body.description) {
    progress("Fetching the posting…");
    ({ source_text: sourceText, ...job } = await captureFromUrl(body.url.trim()));
  } else if (body.description) {
    // Manual paste / bookmarklet: still run extraction so requirements/questions get structured.
    progress("Extracting job details…");
    sourceText = `${body.title ? `Page title: ${body.title}\n` : ""}${body.company ?? ""}\n${body.role ?? ""}\n\n${body.description}`;
    job = await extractJob(sourceText, body.url ?? "");
    if (body.company) job.company = body.company;
    if (body.role) job.role = body.role;
  } else throw new Error("Provide a url or a description");
  const app = createApplication(job, body.url?.trim() || null, sourceText);
  fitInBackground(app.id);
  return { application_id: app.id, company: app.company, role: app.role };
});

registerJob("reextract", async ({ source = "description" }, job, progress) => {
  const app = mustApp(String(job.application_id));
  let extracted: JobExtract, sourceText = app.source_text;
  if (source === "url") {
    if (!app.url) throw new Error("This application has no posting URL");
    progress("Fetching the posting again…");
    ({ source_text: sourceText, ...extracted } = await captureFromUrl(app.url));
  } else {
    const text = app.source_text?.trim() || app.description?.trim();
    if (!text) throw new Error("Nothing to extract from — edit the job and paste a description first");
    progress("Re-reading the description…");
    extracted = await extractJob(app.source_text ? text : `${app.company}\n${app.role}\n\n${text}`, app.url ?? "");
  }
  db.prepare(`UPDATE applications SET company = ?, role = ?, location = ?, salary = ?, description = ?, requirements = ?, source_text = ? WHERE id = ?`).run(
    extracted.company.trim() || app.company, extracted.role.trim() || app.role, extracted.location || app.location, extracted.salary || app.salary,
    extracted.description.trim() || app.description, JSON.stringify(extracted.requirements), sourceText, app.id,
  );
  touch(app.id);
  writeJobFile(getApp(app.id)!);
  logEvent(app.id, "reextracted", source === "url" ? "Fetched the posting again" : "Re-read the description");
  const hasQ = (db.prepare("SELECT COUNT(*) AS n FROM questions WHERE application_id = ?").get(app.id) as any).n > 0;
  if (extracted.application_questions.length && !hasQ) logEvent(app.id, "questions_found", extracted.application_questions.join("\n"));
  fitInBackground(app.id);
  return { application_id: app.id };
});

registerJob("fit", async (_p, job, progress) => {
  const appId = job.application_id!;
  db.prepare("UPDATE applications SET fit_status = 'pending' WHERE id = ?").run(appId);
  try {
    progress("Comparing the posting with your base resume…");
    const fit = await scoreFit(await ctxFor(getApp(appId)!));
    db.prepare("UPDATE applications SET fit_score = ?, fit_json = ?, fit_status = 'done' WHERE id = ?").run(fit.score, JSON.stringify(fit), appId);
    logEvent(appId, "fit", `Scored ${fit.score}/5 — ${fit.verdict}`);
    return { application_id: appId, score: fit.score };
  } catch (e: any) {
    db.prepare("UPDATE applications SET fit_status = 'error', fit_json = ? WHERE id = ?").run(JSON.stringify({ error: e.message }), appId);
    throw e;
  } finally { touch(appId); }
});

registerJob("generate", async ({ what = "both" }, job, progress) => {
  const app = mustApp(String(job.application_id));
  const ctx = await ctxFor(app);
  const out: Record<string, string> = {};
  if (what === "resume" || what === "both") {
    progress("Drafting the tailored resume…");
    let md = await tailorResume(ctx);
    let note = "Tailored resume";
    if (latexReady) {
      progress("Compiling PDF to measure pages…");
      let pages = (await compilePdf(md, "resume").catch(() => null))?.pages ?? null;
      if (pages !== null && pages > 1) {
        progress(`Draft is ${pages} pages — condensing…`);
        md = await condenseResume(ctx, md, pages);
        pages = (await compilePdf(md, "resume").catch(() => null))?.pages ?? null;
        note += ` (condensed → ${pages ?? "?"} page${pages === 1 ? "" : "s"})`;
      }
    } else if (looksTooLong(md)) {
      progress("Draft looks long — condensing…");
      md = await condenseResume(ctx, md);
      note += " (condensed)";
    }
    out.resume = md;
    const id = saveDocument(app, "resume", md);
    if (latexReady) { progress("Building resume PDF…"); await buildPdf(id).catch((e) => console.error("PDF build failed:", e.message)); }
    logEvent(app.id, "generated", note);
  }
  if (what === "cover_letter" || what === "both") {
    progress("Writing the cover letter…");
    const latest = out.resume ?? (db.prepare("SELECT content FROM documents WHERE application_id = ? AND kind = 'resume' ORDER BY id DESC LIMIT 1").get(app.id) as any)?.content ?? ctx.resume;
    out.cover_letter = await writeCoverLetter(ctx, latest);
    const id = saveDocument(app, "cover_letter", out.cover_letter);
    if (latexReady) { progress("Building cover letter PDF…"); await buildPdf(id).catch((e) => console.error("PDF build failed:", e.message)); }
    logEvent(app.id, "generated", "Cover letter");
  }
  return { application_id: app.id, what };
});

registerJob("condense", async ({ document_id }, job, progress) => {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(document_id)) as any;
  if (!doc || doc.kind !== "resume") throw new Error("Resume not found");
  const app = mustApp(String(doc.application_id));
  progress("Condensing to one page…");
  const md = await condenseResume(await ctxFor(app), doc.content, doc.pages ?? undefined);
  const id = saveDocument(app, "resume", md);
  if (latexReady) { progress("Building PDF…"); await buildPdf(id).catch((e) => console.error("PDF build failed:", e.message)); }
  logEvent(app.id, "generated", "Condensed resume");
  return { application_id: app.id, document_id: id };
});

registerJob("questions", async ({ questions }, job, progress) => {
  const app = mustApp(String(job.application_id));
  const qs: string[] = (questions as string[]).map((q) => q.trim()).filter(Boolean);
  progress(`Drafting ${qs.length} answer${qs.length === 1 ? "" : "s"}…`);
  const ctx = await ctxFor(app);
  const prior = db.prepare("SELECT question, answer FROM questions WHERE application_id != ? ORDER BY id DESC LIMIT 40").all(app.id) as any[];
  const answers = await answerQuestions(ctx, qs, prior);
  const ins = db.prepare("INSERT INTO questions (application_id, question, answer) VALUES (?, ?, ?)");
  for (const a of answers) ins.run(app.id, a.question, a.answer);
  writeQuestionsFile(app);
  logEvent(app.id, "questions", `${answers.length} answered`);
  return { application_id: app.id, count: answers.length };
});

registerJob("learn", async ({ document_id }, _job, progress) => {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(document_id)) as any;
  if (!doc) throw new Error("Document not found");
  if (!doc.original || doc.original === doc.content) throw new Error("This version has no manual edits to learn from");
  progress(`Comparing your edits with the generated ${doc.kind === "resume" ? "resume" : "cover letter"}…`);
  const { rules, observed } = await learnStyle(doc.kind, doc.original, doc.content);
  saveStyle(doc.kind, rules.map((r) => `- ${r}`).join("\n"));
  db.prepare("UPDATE documents SET original = content WHERE id = ?").run(doc.id); // these edits are now accounted for
  logEvent(doc.application_id, "learned", `${doc.kind === "resume" ? "Resume" : "Cover letter"} format rules updated (${rules.length} rules)`);
  return { application_id: doc.application_id, kind: doc.kind, rules: rules.length, observed };
});

registerJob("import", async (_p, _job, progress) => {
  progress("Converting your resume to Markdown…");
  await loadResume();
  return { ok: true };
});

async function ctxFor(app: Application) {
  return {
    resume: await loadResume(),
    notes: loadNotes(),
    job: { company: app.company, role: app.role, description: app.description ?? "", requirements: app.requirements ? JSON.parse(app.requirements) : [] },
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
    pendingCaptures.push({ ts: Date.now(), url: String(body.url ?? ""), title: String(body.title ?? ""), text: body.text });
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (m("GET", /^\/api\/captures\/latest$/)) {
    const cutoff = Date.now() - 2 * 60 * 1000;
    while (pendingCaptures.length && pendingCaptures[0].ts < cutoff) pendingCaptures.shift();
    return send(res, 200, pendingCaptures.shift() ?? null); // oldest first, so nothing is skipped
  }

  // Prompts
  if (m("GET", /^\/api\/prompts$/)) return send(res, 200, listPrompts());
  if ((r = m("PUT", /^\/api\/prompts\/(\w+)$/))) {
    const body = await readJson(req);
    savePrompt(r[1], body.reset ? null : String(body.text ?? ""));
    return send(res, 200, listPrompts());
  }

  // LLM settings
  if (m("GET", /^\/api\/settings$/)) return send(res, 200, { ...llmSettings(), providers: PROVIDERS, latex: latexReady });
  if (m("PUT", /^\/api\/settings$/)) return send(res, 200, { ...saveLlmSettings(await readJson(req)), providers: PROVIDERS, latex: latexReady });
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
    const allowed = ["company", "role", "location", "url", "salary", "status", "applied_at", "notes", "description", "requirements"] as const;
    for (const k of allowed) {
      if (!(k in body)) continue;
      if (k === "status" && !STATUSES.includes(body.status)) throw new HttpError(400, "Bad status");
      if ((k === "company" || k === "role") && !String(body[k] ?? "").trim()) throw new HttpError(400, `${k} cannot be empty`);
      const value = k === "requirements" ? JSON.stringify(Array.isArray(body.requirements) ? body.requirements.map(String) : []) : body[k] === undefined ? null : body[k];
      db.prepare(`UPDATE applications SET ${k} = ? WHERE id = ?`).run(value, app.id);
      if (k === "description" && body.description !== app.description) db.prepare("UPDATE applications SET source_text = ? WHERE id = ?").run(body.description, app.id);
      if (k === "status" && body.status !== app.status) {
        logEvent(app.id, "status", `${app.status} → ${body.status}`);
        if (body.status === "applied" && !app.applied_at) db.prepare("UPDATE applications SET applied_at = date('now') WHERE id = ?").run(app.id);
      }
    }
    touch(app.id);
    const updated = getApp(app.id)!;
    if (["company", "role", "location", "url", "salary", "description", "requirements"].some((k) => k in body)) {
      writeJobFile(updated);
      logEvent(app.id, "edited", "Job details updated");
    }
    return send(res, 200, appDetail(updated));
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
    if (latexReady) await buildPdf(doc.id).catch((e) => { pdfError = e.message; });
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

function writeJobFile(app: Application) {
  const reqs: string[] = app.requirements ? JSON.parse(app.requirements) : [];
  fs.writeFileSync(
    path.join(APPS_DIR, app.folder!, "job.md"),
    `# ${app.role} — ${app.company}\n\n${app.url ? `Source: ${app.url}\n` : ""}${app.location ? `Location: ${app.location}\n` : ""}${app.salary ? `Salary: ${app.salary}\n` : ""}\n## Requirements\n${reqs.map((r) => `- ${r}`).join("\n")}\n\n## Description\n${app.description ?? ""}\n`,
  );
}

function writeQuestionsFile(app: Application) {
  const qs = db.prepare("SELECT question, answer FROM questions WHERE application_id = ? ORDER BY id").all(app.id) as any[];
  const md = `# Application questions — ${app.company}\n\n` + qs.map((q) => `## ${q.question}\n\n${q.answer}\n`).join("\n");
  fs.writeFileSync(path.join(APPS_DIR, app.folder!, "questions.md"), md);
  touch(app.id);
}

http.createServer(async (req, res) => {
  try {
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
  }
});
