/**
 * Base resumes. `profile/resume.md` is the default; any other `resume-<key>.md`
 * (e.g. resume-platform.md) is an alternative base. Each can be imported from a
 * matching PDF/DOCX (resume.pdf, resume-platform.pdf …). A first-line comment
 * `<!-- label: Platform / backend -->` gives a base a display name.
 */
import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { PROFILE_DIR } from "./db.ts";
import { pdfToMarkdown, textToMarkdown } from "./ai.ts";

export const DEFAULT_KEY = "default";
export const mdFile = (key: string) => path.join(PROFILE_DIR, key === DEFAULT_KEY ? "resume.md" : `resume-${key}.md`);
/** Body of a base resume without its optional first-line `<!-- label: … -->` comment. */
export const stripLabel = (md: string) => md.replace(/^\s*<!--\s*label:.*?-->\s*\n?/i, "");
const keyOf = (file: string) => { const m = /^resume(?:-([\w.]+))?\.(md|pdf|docx)$/i.exec(file); return m ? (m[1]?.toLowerCase() ?? DEFAULT_KEY) : null; };
const safeKey = (k: string) => k.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

export interface BaseResume { key: string; label: string; file: string; hasMarkdown: boolean; source: string | null; words: number }

function labelOf(key: string, md: string | null) {
  const m = md && /^\s*<!--\s*label:\s*(.+?)\s*-->/i.exec(md);
  if (m) return m[1];
  return key === DEFAULT_KEY ? "Default" : key.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Every base resume on disk (imported or not), default first. */
export function listResumes(): BaseResume[] {
  const files = fs.readdirSync(PROFILE_DIR).filter((f) => !f.startsWith("."));
  const byKey = new Map<string, BaseResume>();
  for (const f of files) {
    const key = keyOf(f); if (!key) continue;
    const cur = byKey.get(key) ?? { key, label: "", file: "", hasMarkdown: false, source: null, words: 0 };
    if (/\.md$/i.test(f)) {
      const md = fs.readFileSync(path.join(PROFILE_DIR, f), "utf8");
      Object.assign(cur, { file: f, hasMarkdown: true, words: md.split(/\s+/).filter(Boolean).length, label: labelOf(key, md) });
    } else cur.source = f;
    byKey.set(key, cur);
  }
  for (const r of byKey.values()) if (!r.label) r.label = labelOf(r.key, null);
  return [...byKey.values()].sort((a, b) => (a.key === DEFAULT_KEY ? -1 : b.key === DEFAULT_KEY ? 1 : a.key.localeCompare(b.key)));
}
export const importedResumes = () => listResumes().filter((r) => r.hasMarkdown);
export const hasAnyResume = () => importedResumes().length > 0;

/** Markdown of one base (default if the key is unknown), importing from PDF/DOCX on first use. */
export async function loadResume(key: string = DEFAULT_KEY): Promise<string> {
  const k = key && importedResumes().some((r) => r.key === key) ? key : (fs.existsSync(mdFile(key || DEFAULT_KEY)) ? key || DEFAULT_KEY : DEFAULT_KEY);
  const md = mdFile(k);
  if (fs.existsSync(md)) return stripLabel(fs.readFileSync(md, "utf8"));
  return importResume(k);
}

/** Convert resume[-key].pdf/.docx to Markdown. */
export async function importResume(key: string = DEFAULT_KEY): Promise<string> {
  const base = key === DEFAULT_KEY ? "resume" : `resume-${key}`;
  const files = fs.readdirSync(PROFILE_DIR);
  const pdf = files.find((f) => f.toLowerCase() === `${base}.pdf`) ?? (key === DEFAULT_KEY ? files.find((f) => /\.pdf$/i.test(f) && keyOf(f) === null) : undefined);
  const docx = files.find((f) => f.toLowerCase() === `${base}.docx`) ?? (key === DEFAULT_KEY ? files.find((f) => /\.docx$/i.test(f) && keyOf(f) === null) : undefined);
  let md: string;
  if (pdf) md = await pdfToMarkdown(fs.readFileSync(path.join(PROFILE_DIR, pdf)));
  else if (docx) { const { value } = await mammoth.extractRawText({ path: path.join(PROFILE_DIR, docx) }); md = await textToMarkdown(value); }
  else throw new Error(key === DEFAULT_KEY ? "No resume found. Put resume.pdf or resume.docx in the profile/ folder." : `No ${base}.pdf or ${base}.docx in profile/.`);
  fs.writeFileSync(mdFile(key), md);
  return md;
}

/** Create a new base from Markdown (e.g. duplicated from another base to edit). */
export function saveResume(key: string, md: string, label?: string) {
  const k = safeKey(key);
  if (!k) throw new Error("Give the base a short name, e.g. platform");
  const body = stripLabel(md);
  fs.writeFileSync(mdFile(k), (label?.trim() ? `<!-- label: ${label.trim()} -->\n` : "") + body);
  return k;
}
export function deleteResume(key: string) {
  if (key === DEFAULT_KEY) throw new Error("The default base can't be deleted");
  const f = mdFile(key);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

export function loadNotes(): string {
  const p = path.join(PROFILE_DIR, "notes.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

export function profileStatus() {
  const resumes = listResumes();
  return {
    hasMarkdown: resumes.some((r) => r.hasMarkdown),
    hasSource: resumes.some((r) => r.source && !r.hasMarkdown),
    files: fs.readdirSync(PROFILE_DIR).filter((f) => !f.startsWith(".")),
    resumes,
  };
}
