import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { PROFILE_DIR } from "./db.ts";
import { pdfToMarkdown, textToMarkdown } from "./ai.ts";

const MD = path.join(PROFILE_DIR, "resume.md");

/** Returns the base resume as markdown, importing from PDF/DOCX on first use. */
export async function loadResume(): Promise<string> {
  if (fs.existsSync(MD)) return fs.readFileSync(MD, "utf8");

  const files = fs.readdirSync(PROFILE_DIR);
  const pdf = files.find((f) => /^resume\.pdf$/i.test(f)) ?? files.find((f) => /\.pdf$/i.test(f));
  const docx = files.find((f) => /^resume\.docx$/i.test(f)) ?? files.find((f) => /\.docx$/i.test(f));

  let md: string;
  if (pdf) {
    md = await pdfToMarkdown(fs.readFileSync(path.join(PROFILE_DIR, pdf)));
  } else if (docx) {
    const { value } = await mammoth.extractRawText({ path: path.join(PROFILE_DIR, docx) });
    md = await textToMarkdown(value);
  } else {
    throw new Error("No resume found. Put resume.pdf or resume.docx in the profile/ folder.");
  }
  fs.writeFileSync(MD, md);
  return md;
}

export function loadNotes(): string {
  const p = path.join(PROFILE_DIR, "notes.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

export function profileStatus() {
  const files = fs.readdirSync(PROFILE_DIR).filter((f) => !f.startsWith("."));
  return {
    hasMarkdown: fs.existsSync(MD),
    hasSource: files.some((f) => /\.(pdf|docx)$/i.test(f)),
    files,
  };
}
