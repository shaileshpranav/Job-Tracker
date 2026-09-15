/**
 * Background job handlers — the actual work behind every model-backed action.
 * Routes only enqueue; see queue.ts for the worker.
 */
import fs from "node:fs";
import path from "node:path";
import { db, getApp, logEvent, saveDocument, slugify, touch, APPS_DIR, PROFILE_DIR, type Application } from "./db.ts";
import { captureFromUrl, CaptureBlocked } from "./scrape.ts";
import { extractJob, tailorResume, condenseResume, looksTooLong, writeCoverLetter, answerQuestions, scoreFit, learnStyle, interviewPrep, quickFit, type JobExtract } from "./ai.ts";
import { feedSettings, fetchBoard, fetchAggregator, matchesKeywords, matchesLocation, isExcluded, insertNew, unscoredIds, getFeedItem, markFeedRefreshed, type Posting } from "./feed.ts";
import { compilePdf } from "./latex.ts";
import { registerJob, enqueue, NeedsYou } from "./queue.ts";
import { loadResume, loadNotes, importedResumes, importResume, hasAnyResume, DEFAULT_KEY } from "./profile.ts";
import { saveStyle } from "./settings.ts";
import { buildPdf, isLatexReady, writeJobFile, writeQuestionsFile } from "./documents.ts";

function mustApp(id: string): Application {
  const app = getApp(Number(id));
  if (!app) throw new Error("Application not found (it may have been deleted)");
  return app;
}

export function createApplication(job: JobExtract, url: string | null, sourceText: string): Application {
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

export function fitInBackground(appId: number) {
  if (!hasAnyResume()) return; // nothing to compare against yet
  const app = getApp(appId)!;
  enqueue("fit", `Fit score — ${app.company}`, {}, appId);
}

export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/**
 * Fetch a posting, or park the job and ask the user to open the page. We never
 * attempt to solve or bypass a verification check — the user passes it in their
 * own browser and hands the page over (bookmarklet or paste).
 */
async function captureOrAsk(url: string, verifiedText?: string) {
  try {
    return await captureFromUrl(url, verifiedText);
  } catch (e) {
    if (!(e instanceof CaptureBlocked)) throw e;
    throw new NeedsYou({
      type: "verify",
      url: e.url,
      host: hostOf(e.url) || e.url,
      reason: e.reason,
      message: `${hostOf(e.url) || "The site"} needs a human: ${e.reason}.`,
    });
  }
}

// ---------- job handlers (the actual work; routes only enqueue) ----------

registerJob("capture", async (body, _job, progress) => {
  let job: JobExtract, sourceText: string;
  if (body.url && !body.description) {
    progress(body.verified_text ? "Reading the page you verified…" : "Fetching the posting…");
    ({ source_text: sourceText, ...job } = await captureOrAsk(body.url.trim(), body.verified_text));
  } else if (body.description) {
    // Manual paste / bookmarklet: still run extraction so requirements/questions get structured.
    progress("Extracting job details…");
    sourceText = `${body.title ? `Page title: ${body.title}\n` : ""}${body.company ?? ""}\n${body.role ?? ""}\n\n${body.description}`;
    job = await extractJob(sourceText, body.url ?? "");
    if (body.company) job.company = body.company;
    if (body.role) job.role = body.role;
  } else throw new Error("Provide a url or a description");
  const app = createApplication(job, body.url?.trim() || null, sourceText);
  if (body.feed_item_id) db.prepare("UPDATE feed_items SET status = 'tracked', application_id = ? WHERE id = ?").run(app.id, Number(body.feed_item_id));
  fitInBackground(app.id);
  return { application_id: app.id, company: app.company, role: app.role };
});

// ---------- job feed ----------

/** All imported base resumes as {key, label, md}. */
async function loadBases() {
  const out = [];
  for (const r of importedResumes()) out.push({ key: r.key, label: r.label, md: await loadResume(r.key) });
  return out;
}
/** Quick-score a posting against every base; keep the best, and say which base when there's more than one. */
async function bestQuickFit(bases: { key: string; label: string; md: string }[], notes: string, posting: any) {
  let best: { score: number; reason: string } | null = null;
  for (const b of bases) {
    const r = await quickFit(b.md, notes, posting);
    const reason = `${bases.length > 1 ? `[${b.label}] ` : ""}${cleanReason(r.reason)}`;
    if (!best || r.score > best.score) best = { score: r.score, reason };
  }
  return best!;
}

/** Small models sometimes pad structured fields with junk; keep one clean sentence. */
const cleanReason = (r: string) => String(r ?? "").replace(/\s+/g, " ").replace(/(\b\S+\b)(?:\s+\1\b){3,}/g, "$1").trim().slice(0, 240);

registerJob("feed_refresh", async (_p, _job, progress) => {
  const s = feedSettings();
  const sources = [...s.boards.map((b) => ({ name: b, run: () => fetchBoard(b) })), ...(["arbeitnow", "remoteok", "remotive"] as const).filter((a) => s.aggregators[a]).map((a) => ({ name: a, run: () => fetchAggregator(a, s.keywords) }))];
  if (!sources.length) throw new Error("No sources configured — add company boards or enable an aggregator in the feed settings");
  const report: Record<string, string> = {};
  const kept: Posting[] = [];
  for (const [i, src] of sources.entries()) {
    progress(`Fetching ${src.name} (${i + 1}/${sources.length})…`);
    try {
      const all = await src.run();
      const matched = all.filter((p) => p.url && p.title && matchesKeywords(p.title, s.keywords) && matchesLocation(p, s.locations) && !isExcluded(p, s.exclude));
      kept.push(...matched);
      report[src.name] = `${matched.length} of ${all.length} matched`;
    } catch (e: any) {
      report[src.name] = `failed: ${e.message}`;
    }
  }
  const added = insertNew(kept);
  markFeedRefreshed();
  // Triage the newest unscored ones, up to the cap.
  const ids = unscoredIds(s.scorePerRefresh);
  let scored = 0, hot = 0;
  if (ids.length && hasAnyResume()) {
    const bases = await loadBases(), notes = loadNotes();
    for (const [i, id] of ids.entries()) {
      progress(`Scoring ${i + 1}/${ids.length}…`);
      const it = getFeedItem(id);
      try {
        const r = await bestQuickFit(bases, notes, it);
        db.prepare("UPDATE feed_items SET fit_score = ?, fit_reason = ? WHERE id = ?").run(r.score, r.reason, id);
        scored++; if (r.score >= s.minScore) hot++;
      } catch (e: any) {
        db.prepare("UPDATE feed_items SET fit_reason = ? WHERE id = ?").run(`scoring failed: ${e.message}`.slice(0, 300), id);
      }
    }
  }
  return { added, scored, hot, report };
});

registerJob("feed_score", async ({ ids }, _job, progress) => {
  const s = feedSettings();
  const bases = await loadBases(), notes = loadNotes();
  let hot = 0;
  for (const [i, id] of (ids as number[]).entries()) {
    const it = getFeedItem(id); if (!it) continue;
    progress(`Scoring ${it.company} — ${it.title} (${i + 1}/${ids.length})…`);
    const r = await bestQuickFit(bases, notes, it);
    db.prepare("UPDATE feed_items SET fit_score = ?, fit_reason = ? WHERE id = ?").run(r.score, r.reason, id);
    if (r.score >= s.minScore) hot++;
  }
  return { scored: ids.length, hot };
});

registerJob("reextract", async ({ source = "description", verified_text }, job, progress) => {
  const app = mustApp(String(job.application_id));
  let extracted: JobExtract, sourceText = app.source_text;
  if (source === "url") {
    if (!app.url) throw new Error("This application has no posting URL");
    progress(verified_text ? "Reading the page you verified…" : "Fetching the posting again…");
    ({ source_text: sourceText, ...extracted } = await captureOrAsk(app.url, verified_text));
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
    const app = getApp(appId)!;
    const bases = importedResumes();
    const all: Record<string, any> = {};
    for (const [i, b] of bases.entries()) {
      progress(bases.length > 1 ? `Comparing with your “${b.label}” resume (${i + 1}/${bases.length})…` : "Comparing the posting with your base resume…");
      all[b.key] = { label: b.label, ...(await scoreFit(await ctxFor(app, b.key))) };
    }
    // Use the pinned base if the user chose one, otherwise the best-scoring base.
    const bestKey = Object.keys(all).sort((a, b) => all[b].score - all[a].score)[0] ?? DEFAULT_KEY;
    const key = app.resume_pinned && app.resume_key && all[app.resume_key] ? app.resume_key : bestKey;
    const fit = all[key];
    db.prepare("UPDATE applications SET fit_score = ?, fit_json = ?, fit_all = ?, resume_key = ?, fit_status = 'done' WHERE id = ?").run(fit.score, JSON.stringify(fit), JSON.stringify(all), key, appId);
    logEvent(appId, "fit", `Scored ${fit.score}/5${bases.length > 1 ? ` with the “${fit.label}” resume` : ""} — ${fit.verdict}`);
    return { application_id: appId, score: fit.score, resume_key: key };
  } catch (e: any) {
    db.prepare("UPDATE applications SET fit_status = 'error', fit_json = ? WHERE id = ?").run(JSON.stringify({ error: e.message }), appId);
    throw e;
  } finally { touch(appId); }
});

registerJob("generate", async ({ what = "both", emphasize = [] }, job, progress) => {
  const app = mustApp(String(job.application_id));
  const ctx = await ctxFor(app);
  const out: Record<string, string> = {};
  if (what === "resume" || what === "both") {
    progress(emphasize.length ? `Drafting the tailored resume (working in ${emphasize.length} ATS terms)…` : "Drafting the tailored resume…");
    let md = await tailorResume(ctx, emphasize);
    let note = "Tailored resume";
    if (isLatexReady()) {
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
    if (isLatexReady()) { progress("Building resume PDF…"); await buildPdf(id).catch((e) => console.error("PDF build failed:", e.message)); }
    logEvent(app.id, "generated", note);
  }
  if (what === "cover_letter" || what === "both") {
    progress("Writing the cover letter…");
    const latest = out.resume ?? (db.prepare("SELECT content FROM documents WHERE application_id = ? AND kind = 'resume' ORDER BY id DESC LIMIT 1").get(app.id) as any)?.content ?? ctx.resume;
    out.cover_letter = await writeCoverLetter(ctx, latest);
    const id = saveDocument(app, "cover_letter", out.cover_letter);
    if (isLatexReady()) { progress("Building cover letter PDF…"); await buildPdf(id).catch((e) => console.error("PDF build failed:", e.message)); }
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
  if (isLatexReady()) { progress("Building PDF…"); await buildPdf(id).catch((e) => console.error("PDF build failed:", e.message)); }
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

registerJob("prep", async (_p, job, progress) => {
  const app = mustApp(String(job.application_id));
  progress("Preparing your interview sheet…");
  const md = await interviewPrep(await ctxFor(app), app.fit_json ? JSON.parse(app.fit_json) : null);
  const id = saveDocument(app, "prep", md);
  logEvent(app.id, "generated", "Interview prep sheet");
  return { application_id: app.id, document_id: id };
});

registerJob("import", async ({ key = DEFAULT_KEY }, _job, progress) => {
  progress(`Converting your ${key === DEFAULT_KEY ? "" : key + " "}resume to Markdown…`);
  await importResume(key);
  return { ok: true, key };
});

export async function ctxFor(app: Application, resumeKey?: string) {
  return {
    resume: await loadResume(resumeKey ?? app.resume_key ?? undefined),
    notes: loadNotes(),
    job: { company: app.company, role: app.role, description: app.description ?? "", requirements: app.requirements ? JSON.parse(app.requirements) : [] },
  };
}
