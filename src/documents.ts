/**
 * Files that live next to each application: job.md, questions.md, and the
 * LaTeX/PDF builds of generated documents.
 */
import fs from "node:fs";
import path from "node:path";
import { db, touch, APPS_DIR, ROOT, type Application } from "./db.ts";
import { compilePdf, compileTex, latexAvailable, markdownToTex, contentHash } from "./latex.ts";
import { loadResume } from "./profile.ts";
import { pdfFileName } from "./filenames.ts";

let latexReady = false;
export const isLatexReady = () => latexReady;
latexAvailable().then((ok) => { latexReady = ok; console.log(ok ? "LaTeX found → PDF export enabled" : "LaTeX not found → PDF export uses browser print"); });

/** Name/contact header for cover letters, taken from the base resume. */
export async function letterHeader(resumeKey?: string | null) {
  try { const { name, contact } = markdownToTex(await loadResume(resumeKey ?? undefined)); return { name, contact }; } catch { return undefined; }
}

/** Compile a document to PDF, cache it next to the Markdown, record the page count. */
export async function buildPdf(docId: number) {
  const doc = db.prepare("SELECT d.*, a.folder, a.company, a.resume_key FROM documents d JOIN applications a ON a.id = d.application_id WHERE d.id = ?").get(docId) as any;
  if (!doc) throw new Error("Document not found");
  const hash = contentHash(doc.tex ?? doc.content);
  // Named for the recruiter (see filenames.ts); a stale file under an older name is removed on rebuild.
  const pdfPath = path.join(APPS_DIR, doc.folder, pdfFileName(doc, doc.kind));
  if (doc.pdf_hash === hash && fs.existsSync(pdfPath)) return { pdf: fs.readFileSync(pdfPath), pages: doc.pages as number };
  const r = doc.tex ? await compileTex(doc.tex) : await compilePdf(doc.content, doc.kind, doc.kind === "cover_letter" ? await letterHeader(doc.resume_key) : undefined);
  fs.writeFileSync(path.join(APPS_DIR, doc.folder, doc.kind === "resume" ? "resume.tex" : "cover-letter.tex"), r.tex);
  const old = doc.pdf ? path.join(ROOT, doc.pdf) : null;
  if (old && old !== pdfPath && fs.existsSync(old)) fs.rmSync(old, { force: true });
  fs.writeFileSync(pdfPath, r.pdf);
  db.prepare("UPDATE documents SET pages = ?, pdf = ?, pdf_hash = ? WHERE id = ?").run(r.pages, path.relative(ROOT, pdfPath), hash, doc.id);
  return { pdf: r.pdf, pages: r.pages };
}

export function writeJobFile(app: Application) {
  const reqs: string[] = app.requirements ? JSON.parse(app.requirements) : [];
  fs.writeFileSync(
    path.join(APPS_DIR, app.folder!, "job.md"),
    `# ${app.role} — ${app.company}\n\n${app.url ? `Source: ${app.url}\n` : ""}${app.location ? `Location: ${app.location}\n` : ""}${app.salary ? `Salary: ${app.salary}\n` : ""}\n## Requirements\n${reqs.map((r) => `- ${r}`).join("\n")}\n\n## Description\n${app.description ?? ""}\n`,
  );
}

export function writeQuestionsFile(app: Application) {
  const qs = db.prepare("SELECT question, answer FROM questions WHERE application_id = ? ORDER BY id").all(app.id) as any[];
  const md = `# Application questions — ${app.company}\n\n` + qs.map((q) => `## ${q.question}\n\n${q.answer}\n`).join("\n");
  fs.writeFileSync(path.join(APPS_DIR, app.folder!, "questions.md"), md);
  touch(app.id);
}
