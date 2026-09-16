/**
 * Recruiter-facing names for exported PDFs — "Shailesh-Pranav-Rajendran-Resume.pdf"
 * rather than "micron-technology-resume.pdf". The candidate's name is read from the
 * heading of the base resume the application uses; the pattern lives in Settings.
 */
import fs from "node:fs";
import { DEFAULT_KEY, mdFile, stripLabel } from "./profile.ts";
import { pdfNamePattern } from "./settings.ts";

export const DEFAULT_PDF_NAME = "{name}-{kind}";

const stripInline = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
const titleCase = (s: string) => s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
const nameCache = new Map<string, { mtime: number; name: string }>();

/** The name at the top of a base resume: "# SHAILESH PRANAV RAJENDRAN" → "Shailesh Pranav Rajendran". */
export function candidateName(resumeKey?: string | null): string {
  let file = mdFile(resumeKey || DEFAULT_KEY);
  if (!fs.existsSync(file)) file = mdFile(DEFAULT_KEY); // a base that was deleted → fall back to the default
  if (!fs.existsSync(file)) return "";
  const mtime = fs.statSync(file).mtimeMs;
  const hit = nameCache.get(file);
  if (hit && hit.mtime === mtime) return hit.name;
  const first = stripLabel(fs.readFileSync(file, "utf8")).split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  let name = stripInline(first.replace(/^#+\s*/, ""));
  if (!name || name.length > 60 || /[|@\d]/.test(name)) name = ""; // a contact line or a title, not a name
  else if (name === name.toUpperCase()) name = titleCase(name);
  nameCache.set(file, { mtime, name });
  return name;
}

/** Hyphenate and drop anything that could upset an upload form or a file system. */
const safe = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "");

/** File name (with .pdf) for one of an application's documents, from the pattern in Settings. */
export function pdfFileName(app: { company: string; resume_key?: string | null }, kind: string): string {
  const kindLabel = kind === "resume" ? "Resume" : "Cover-Letter";
  const name = candidateName(app.resume_key) || app.company;
  let pattern = pdfNamePattern() || DEFAULT_PDF_NAME;
  if (!/\{kind\}/i.test(pattern)) pattern += "-{kind}"; // the two documents must never share a file
  // Replacer functions: a "$&" in a company name must stay literal.
  const out = safe(pattern.replace(/\{name\}/gi, () => name).replace(/\{kind\}/gi, () => kindLabel).replace(/\{company\}/gi, () => app.company));
  return `${out || safe(`${app.company}-${kindLabel}`) || kindLabel}.pdf`;
}
