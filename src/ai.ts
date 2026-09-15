/** Prompt assembly. Editable text lives in prompts.ts; model calls go through llm.ts. */
import { z } from "zod";
import { getLLMFor } from "./llm.ts";
import { guarded, checks } from "./guard.ts";
import { getPrompt } from "./prompts.ts";
import { getStyle, taskRoute, type StyleKind } from "./settings.ts";

// ---------- Profile ----------

export function pdfToMarkdown(pdf: Buffer) {
  return guarded("import", checks.markdown, (r) => getLLMFor(r).pdfToMarkdown(pdf, getPrompt("import")));
}

export function textToMarkdown(text: string) {
  return guarded("import", checks.markdown, (r) => getLLMFor(r).generate("You convert documents to Markdown.", `${getPrompt("import")}\n\n<resume>\n${text}\n</resume>`));
}

// ---------- Job capture ----------

const JobSchema = z.object({
  company: z.string(),
  role: z.string(),
  location: z.string().describe("City/remote/hybrid as stated; empty string if unknown"),
  salary: z.string().describe("Compensation as stated, or empty string"),
  description: z.string().describe("The full job description in Markdown, cleaned of site chrome, ads and boilerplate. Keep all responsibilities, requirements, benefits, and application instructions."),
  requirements: z.array(z.string()).describe("Distinct must-have skills/qualifications, one per item, short"),
  application_questions: z.array(z.string()).describe("Any free-text questions the application form asks (e.g. 'Why do you want to work here?'). Empty if none visible."),
});
export type JobExtract = z.infer<typeof JobSchema>;

export function extractJob(pageText: string, url: string) {
  const text = pageText.slice(0, 120_000);
  return guarded("capture", checks.job, (r) => getLLMFor(r).structured(getPrompt("capture"), `URL: ${url}\n\n<page>\n${text}\n</page>`, JobSchema), { sourceLength: text.length });
}

/** Fallback when local fetch fails (JS-rendered / bot-blocked pages): let the provider fetch it, if it can. */
export async function fetchJobViaLLM(url: string): Promise<JobExtract & { source_text: string }> {
  const text = await getLLMFor(taskRoute("capture")).fetchUrlText(url);
  if (text === null) throw new Error("Could not read the posting (the site blocks scrapers, and the current provider has no web fetch). Use the bookmarklet or 'paste the description' instead.");
  if (text.length < 200) throw new Error("Could not fetch the posting. Use the bookmarklet or paste the job description instead.");
  return { ...(await extractJob(text, url)), source_text: text };
}

// ---------- Tailoring ----------

interface Ctx { resume: string; notes: string; job: { company: string; role: string; description: string; requirements: string[] } }

function jobBlock(j: Ctx["job"]) {
  return `<job company="${j.company}" role="${j.role}">\n${j.description}\n\nKey requirements:\n${j.requirements.map((r) => `- ${r}`).join("\n")}\n</job>`;
}
function profileBlock(c: Ctx) {
  return `<base_resume>\n${c.resume}\n</base_resume>` + (c.notes ? `\n\n<candidate_notes>\n${c.notes}\n</candidate_notes>` : "");
}

/** Rough one-page budget for a 10.5pt Letter resume. */
export const ONE_PAGE = { words: 520, lines: 48 };
export function resumeSize(md: string) {
  return { words: md.split(/\s+/).filter(Boolean).length, lines: md.split("\n").filter((l) => l.trim()).length };
}

/** Learned formatting preferences, injected into the writing prompts. */
function styleBlock(kind: StyleKind) {
  const rules = getStyle(kind);
  return rules ? `\n\n<formatting_preferences>\nThe candidate has edited previous documents; follow these formatting and style rules exactly (they never change the facts):\n${rules}\n</formatting_preferences>` : "";
}

const resumeSystem = (c: Ctx) => `${getPrompt("resume_system")} ${getPrompt("honesty")}${styleBlock("resume")}\n\n${profileBlock(c)}`;

/** First draft. The caller decides (by real page count when LaTeX is available) whether to condense. */
export function tailorResume(c: Ctx, emphasize: string[] = []) {
  const emph = emphasize.length
    ? `\n\nATS note: where it is truthful, use these exact terms from the posting (they are what a screening system will search for): ${emphasize.join(", ")}. Never claim a skill the base resume doesn't support — if a term doesn't apply, leave it out.`
    : "";
  return guarded("resume", checks.markdown, (r) => getLLMFor(r).generate(resumeSystem(c), `${getPrompt("resume_task")}${emph}\n\n${jobBlock(c.job)}`));
}

/** Bounded shortening pass for a draft that runs past one page. */
export function condenseResume(c: Ctx, md: string, pages?: number) {
  const why = pages ? `It currently compiles to ${pages} pages. ` : "";
  return guarded("resume", checks.markdown, (r) => getLLMFor(r).generate(resumeSystem(c), `${why}${getPrompt("resume_condense")}\n\n${jobBlock(c.job)}\n\n<resume>\n${md}\n</resume>`));
}

/** Heuristic used only when LaTeX isn't available to measure real pages. */
export function looksTooLong(md: string) {
  const s = resumeSize(md);
  return s.words > ONE_PAGE.words || s.lines > ONE_PAGE.lines;
}

// ---------- Fit score ----------

const FitSchema = z.object({
  score: z.number().int().min(1).max(5).describe("1–5 fit score"),
  verdict: z.string().describe("One sentence: apply or not, and why"),
  met: z.array(z.string()).describe("Requirements clearly met, each with the evidence from the resume in brackets"),
  partial: z.array(z.string()).describe("Requirements partially met or met by adjacent experience — what the gap is"),
  missing: z.array(z.string()).describe("Requirements with no supporting evidence in the resume"),
  advice: z.string().describe("2-3 sentences: what to emphasise or how to frame the gaps if applying; or what to change before this role makes sense"),
});
export type Fit = z.infer<typeof FitSchema>;

export function scoreFit(c: Ctx) {
  return guarded("fit", checks.fit, (r) => getLLMFor(r).structured(`${getPrompt("fit")}\n\n${profileBlock(c)}`, jobBlock(c.job), FitSchema));
}

export function writeCoverLetter(c: Ctx, tailoredResume: string) {
  return guarded("cover_letter", checks.markdown, (r) => getLLMFor(r).generate(
    `${getPrompt("cover_system")} ${getPrompt("honesty")}${styleBlock("cover_letter")}\n\n${profileBlock(c)}`,
    `${getPrompt("cover_task")}\n\n${jobBlock(c.job)}\n\n<tailored_resume>\n${tailoredResume}\n</tailored_resume>`,
    8000,
  ));
}

// ---------- Application questions ----------

const AnswersSchema = z.object({
  answers: z.array(z.object({ question: z.string(), answer: z.string() })),
});

export async function answerQuestions(c: Ctx, questions: string[], priorQA: { question: string; answer: string }[]) {
  const prior = priorQA.length
    ? `\n\n<previous_answers>\nAnswers the candidate has given on other applications. Reuse their substance and voice where the question is similar; adapt to this company.\n${priorQA.map((q) => `Q: ${q.question}\nA: ${q.answer}`).join("\n\n")}\n</previous_answers>`
    : "";
  const res = await guarded("questions", checks.answers, (r) => getLLMFor(r).structured(
    `${getPrompt("questions_system")} ${getPrompt("honesty")}\n\n${profileBlock(c)}${prior}`,
    `${jobBlock(c.job)}\n\nQuestions:\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nReturn one answer per question, with the question text copied exactly.`,
    AnswersSchema,
  ));
  return res.answers;
}

// ---------- Learn formatting preferences from manual edits ----------

const StyleSchema = z.object({
  changes_observed: z.array(z.string()).describe("Formatting/style differences noticed between the generated and edited versions, briefly"),
  rules: z.array(z.string()).describe("The complete, updated rule list (existing rules merged with what the edits show). One line each, imperative."),
});

export async function learnStyle(kind: StyleKind, original: string, edited: string) {
  const current = getStyle(kind);
  const res = await guarded("learn", checks.style, (r) => getLLMFor(r).structured(
    getPrompt("learn_style"),
    `Document type: ${kind === "resume" ? "resume" : "cover letter"}\n\n<current_rules>\n${current || "(none yet)"}\n</current_rules>\n\n<generated>\n${original}\n</generated>\n\n<edited_by_candidate>\n${edited}\n</edited_by_candidate>`,
    StyleSchema,
  ));
  return { rules: res.rules.map((r) => r.replace(/^[-*•]\s*/, "").trim()).filter(Boolean).slice(0, 25), observed: res.changes_observed };
}

// ---------- Interview prep ----------

export function interviewPrep(c: Ctx, fit: Fit | null) {
  const fitBlock = fit
    ? `\n\n<fit_assessment score="${fit.score}/5">\nVerdict: ${fit.verdict}\nMet: ${fit.met.join("; ") || "-"}\nPartial: ${fit.partial.join("; ") || "-"}\nMissing: ${fit.missing.join("; ") || "-"}\n</fit_assessment>`
    : "";
  return guarded("prep", checks.markdown, (r) => getLLMFor(r).generate(
    `${getPrompt("prep")} ${getPrompt("honesty")}\n\n${profileBlock(c)}`,
    `${jobBlock(c.job)}${fitBlock}\n\nWrite the prep sheet now. Output only the Markdown.`,
  ));
}

// ---------- Feed triage ----------

const QuickFitSchema = z.object({
  score: z.number().int().min(1).max(5),
  reason: z.string().describe("One sentence naming the decisive factor"),
});

export function quickFit(resume: string, notes: string, posting: { company: string; title: string; location: string; description: string }) {
  const body = `<posting company="${posting.company}" title="${posting.title}" location="${posting.location}">\n${posting.description.slice(0, 8000) || "(no description available — judge from the title)"}\n</posting>`;
  return guarded("feed", checks.quickfit, (r) => getLLMFor(r).structured(`${getPrompt("feed_fit")}\n\n${profileBlock({ resume, notes, job: { company: "", role: "", description: "", requirements: [] } })}`, body, QuickFitSchema, 2000));
}

// ---------- Translation ----------

const TitlesSchema = z.object({ titles: z.array(z.string()).describe("English translations, same order and count as the input") });
/** Batch-translate job titles (cheap: one call per ~60 titles). Returns a map original → English. */
export async function translateTitles(titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(titles.map((t) => t.trim()).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 60) {
    const chunk = uniq.slice(i, i + 60);
    const r = await guarded("translate", checks.titles, (rt) => getLLMFor(rt).structured(getPrompt("translate"), `Translate these job titles into English. Return exactly ${chunk.length} titles in the same order.\n\n${chunk.map((t, k) => `${k + 1}. ${t}`).join("\n")}`, TitlesSchema, 4000));
    chunk.forEach((t, k) => { const en = r.titles[k]?.replace(/^\d+[.)]\s*/, "").trim(); if (en) out.set(t, en); });
  }
  return out;
}

const JobTranslationSchema = z.object({
  role: z.string(), location: z.string(), salary: z.string(),
  description: z.string().describe("The full description in English Markdown, complete"),
  requirements: z.array(z.string()),
});
/** Translate a captured posting's text fields into English. */
export async function translateJob(job: { role: string; location: string | null; salary: string | null; description: string; requirements: string[] }) {
  const src = `<role>${job.role}</role>\n<location>${job.location ?? ""}</location>\n<salary>${job.salary ?? ""}</salary>\n<requirements>\n${job.requirements.map((r) => `- ${r}`).join("\n")}\n</requirements>\n<description>\n${job.description}\n</description>`;
  const t = await guarded("translate", checks.translation, (rt) => getLLMFor(rt).structured(getPrompt("translate"), `Translate every field of this job posting into English. Return requirements as separate array items (${job.requirements.length} expected).\n\n${src}`, JobTranslationSchema), { sourceLength: job.description.length });
  // Small models sometimes return the list as one dash-joined string, or leave the title untouched.
  const requirements = t.requirements.flatMap((r) => r.split(/\n|\s+-\s+|(?<=\S)\s*•\s*/).map((x) => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean));
  const role = t.role.replace(/\s*\((?:m\/w\/d|w\/m\/d|f\/m\/d|m\/f\/d|f\/m\/x|m\/w\/x|all genders|d\/m\/w)\)\s*/gi, " ").replace(/\bKI\b/g, "AI").replace(/\s+/g, " ").trim();
  return { ...t, role, requirements };
}
