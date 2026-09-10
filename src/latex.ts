/**
 * Markdown -> LaTeX -> PDF, deterministically (no model involved), so the
 * model can never produce broken TeX. Uses MacTeX/TeX Live if present.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROOT } from "./db.ts";

const run = promisify(execFile);
const TEX_BIN_DIRS = ["/Library/TeX/texbin", "/usr/local/texlive/2025/bin/universal-darwin", "/usr/local/bin", "/opt/homebrew/bin"];
const PATH = [...TEX_BIN_DIRS, process.env.PATH ?? ""].join(":");

let available: boolean | null = null;
export async function latexAvailable(): Promise<boolean> {
  if (available !== null) return available;
  try { await run("latexmk", ["-version"], { env: { ...process.env, PATH } }); available = true; }
  catch { available = false; }
  return available;
}

// ---------- Markdown -> LaTeX ----------

const ESC: Record<string, string> = { "\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", "$": "\\$", "#": "\\#", "_": "\\_", "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" };
export function escapeTex(s: string) {
  return s.replace(/[\\&%$#_{}~^]/g, (c) => ESC[c]).replace(/"([^"]*)"/g, "``$1''");
}

/** Inline markdown (bold, italic, code, links) -> LaTeX, escaping everything else. */
function inline(s: string): string {
  const parts: string[] = [];
  const re = /\*\*(.+?)\*\*|(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    parts.push(escapeTex(s.slice(last, m.index)));
    if (m[1] !== undefined) parts.push(`\\textbf{${inline(m[1])}}`);
    else if (m[2] !== undefined) parts.push(`\\textit{${inline(m[2])}}`);
    else if (m[3] !== undefined) parts.push(`\\texttt{${escapeTex(m[3])}}`);
    else if (m[4] !== undefined) parts.push(`\\href{${m[5].replace(/[%#]/g, (c) => "\\" + c)}}{${inline(m[4])}}`);
    else if (m[6] !== undefined) parts.push(`\\url{${m[6]}}`);
    last = m.index + m[0].length;
  }
  parts.push(escapeTex(s.slice(last)));
  return parts.join("");
}

export interface TexDoc { name: string; contact: string; body: string }

/**
 * Resume conventions (as produced by the import prompt): '# Name', contact
 * line(s), then '## Section's containing entry lines ('**Role — Company** dates'
 * or '### Role | dates'), plain lines, and bullets. Anything else degrades to
 * plain paragraphs.
 */
export function markdownToTex(md: string): TexDoc {
  const lines = md.replace(/\r/g, "").split("\n");
  let name = "", contact: string[] = [], seenSection = false;
  const body: string[] = [];
  let list: "itemize" | "enumerate" | null = null;
  const closeList = () => { if (list) { body.push(`\\end{${list}}`); list = null; } };

  // No '# Name' heading? Treat the first non-empty line as the name.
  const firstIdx = lines.findIndex((l) => l.trim());
  if (firstIdx >= 0 && !/^#/.test(lines[firstIdx].trim())) lines[firstIdx] = `# ${lines[firstIdx].trim().replace(/^\*\*(.+)\*\*$/, "$1")}`;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h1 = /^#\s+(.*)/.exec(line), h2 = /^##\s+(.*)/.exec(line), h3 = /^###+\s+(.*)/.exec(line);
    const li = /^\s*[-*+•]\s+(.*)/.exec(line), oli = /^\s*\d+[.)]\s+(.*)/.exec(line);
    if (h1 && !name) { name = inline(h1[1]); continue; }
    if (!seenSection && !h2 && name) {
      if (line.trim()) contact.push(inline(line.trim()));
      continue;
    }
    if (h2) { closeList(); seenSection = true; body.push(`\\section*{${inline(h2[1])}}`); continue; }
    if (h3) { closeList(); body.push(entry(h3[1])); continue; }
    if (li || oli) {
      const want = li ? "itemize" : "enumerate";
      if (list !== want) { closeList(); list = want; body.push(`\\begin{${want}}`); }
      body.push(`  \\item ${inline((li ?? oli)![1])}`);
      continue;
    }
    closeList();
    if (!line.trim()) { body.push(""); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { body.push("\\vspace{2pt}\\hrule\\vspace{2pt}"); continue; }
    // '**Role — Company** Jan 2020 – Present'  ->  entry with right-aligned dates.
    // Only when the trailing text looks like a date range; '**Languages:** Python' stays a plain line.
    const bold = /^\*\*(.+?)\*\*\s*(.*)$/.exec(line.trim());
    if (bold && bold[2] && /\b(19|20)\d{2}\b|\b(present|current|now)\b/i.test(bold[2]) && bold[2].length < 60) { body.push(entry(`${bold[1]} | ${bold[2]}`)); continue; }
    body.push(`${inline(line.trim())}\\\\`);
  }
  closeList();
  // A trailing '\\' before a section/list/blank makes LaTeX complain; tidy those up.
  const cleaned = body.map((l, i) => {
    const next = body[i + 1] ?? "";
    return l.endsWith("\\\\") && (!next.trim() || next.startsWith("\\section") || next.startsWith("\\begin") || next.startsWith("\\par") || next.startsWith("\\vspace")) ? l.slice(0, -2) : l;
  });
  return { name, contact: contact.join(" \\\\ "), body: cleaned.join("\n").replace(/\n{3,}/g, "\n\n") };
}

function entry(text: string): string {
  const [left, ...rest] = text.split(" | ");
  const right = rest.join(" | ");
  return right ? `\\entry{${inline(left.trim())}}{${inline(right.trim())}}` : `\\entry{${inline(left.trim())}}{}`;
}

function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

const TEMPLATE_FILE = { resume: "resume.tex", cover_letter: "letter.tex" } as const;
export function readTemplate(kind: "resume" | "cover_letter", defaults = false) {
  return fs.readFileSync(path.join(ROOT, "templates", defaults ? "defaults" : "", TEMPLATE_FILE[kind]), "utf8");
}
export function writeTemplate(kind: "resume" | "cover_letter", text: string | null) {
  fs.writeFileSync(path.join(ROOT, "templates", TEMPLATE_FILE[kind]), text ?? readTemplate(kind, true));
}

export function renderTex(md: string, kind: "resume" | "cover_letter", header?: { name: string; contact: string }): string {
  const template = readTemplate(kind);
  const doc = markdownToTex(md);
  if (kind === "resume") return fill(template, { NAME: doc.name, CONTACT: doc.contact, BODY: doc.body });
  // Cover letters have no '# Name' — take the header from the base resume, body is the whole letter.
  const paras = md.trim().split(/\n{2,}/).map((p) => {
    const items = p.split("\n").filter((l) => /^\s*[-*+]\s+/.test(l));
    if (items.length === p.split("\n").length) return `\\begin{itemize}\n${items.map((l) => `  \\item ${inline(l.replace(/^\s*[-*+]\s+/, ""))}`).join("\n")}\n\\end{itemize}`;
    return inline(p.replace(/\n/g, " "));
  });
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return fill(template, { NAME: header?.name ?? "", CONTACT: header?.contact ?? "", DATE: escapeTex(date), BODY: paras.join("\n\n") });
}

// ---------- Compile ----------

export interface CompileResult { pdf: Buffer; pages: number; tex: string }

/** Compile Markdown to PDF. Throws with the relevant log excerpt on failure. */
export async function compilePdf(md: string, kind: "resume" | "cover_letter", header?: { name: string; contact: string }): Promise<CompileResult> {
  return compileTex(renderTex(md, kind, header));
}

/** Compile a complete .tex document (generated, or hand-edited by the user). */
export async function compileTex(tex: string): Promise<CompileResult> {
  if (!(await latexAvailable())) throw new Error("LaTeX (latexmk/xelatex) not found — install MacTeX or BasicTeX, or use Print / Save as PDF.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobtracker-tex-"));
  try {
    fs.writeFileSync(path.join(dir, "doc.tex"), tex);
    let log = "";
    try {
      const { stdout } = await run("latexmk", ["-xelatex", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "doc.tex"],
        { cwd: dir, env: { ...process.env, PATH }, timeout: 90_000, maxBuffer: 16 * 1024 * 1024 });
      log = stdout;
    } catch (e: any) {
      log = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
      const err = log.match(/^(?:.*\.tex:\d+:.*|! .*)$/m)?.[0] ?? (e.killed ? "compile timed out" : e.message);
      throw new Error(`LaTeX compile failed: ${err.trim()}`);
    }
    const pdf = fs.readFileSync(path.join(dir, "doc.pdf"));
    const logFile = fs.existsSync(path.join(dir, "doc.log")) ? fs.readFileSync(path.join(dir, "doc.log"), "utf8") : log;
    const pages = Number(logFile.match(/Output written on .*?\((\d+) pages?/)?.[1] ?? 0) || countPdfPages(pdf);
    return { pdf, pages, tex };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function countPdfPages(pdf: Buffer): number {
  const m = pdf.toString("latin1").match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
  return m ? Number(m[1]) : 1;
}

export const contentHash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
