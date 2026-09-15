/**
 * Editable prompt text. Each piece is an instruction fragment; the code appends
 * the dynamic context (base resume, notes, job posting, prior answers) itself,
 * so users can tune wording without breaking the plumbing.
 */
import { db } from "./db.ts";

db.exec("CREATE TABLE IF NOT EXISTS prompts (key TEXT PRIMARY KEY, text TEXT NOT NULL)");

export const DEFAULT_PROMPTS = {
  honesty: {
    label: "Honesty rule (shared by every writing task)",
    help: "Appended to the resume, cover letter and answers prompts.",
    text: "Hard rule: never invent experience, employers, titles, dates, metrics, or skills that are not in the base resume or notes. You may reorder, reword, emphasise, and cut. If a requirement is not met, do not pretend it is.",
  },
  import: {
    label: "Resume import (PDF/DOCX → Markdown)",
    help: "Runs once when profile/resume.md is created from your PDF/DOCX.",
    text: "Convert this resume into clean, faithful Markdown. Preserve every fact (names, dates, employers, titles, bullets, skills, education, links). Use '# Name' then contact line, then '## ' sections. Do not add, embellish, or drop anything. Output only the Markdown.",
  },
  capture: {
    label: "Job capture (system prompt for extraction)",
    help: "The page text and URL are appended. Output fields are fixed by the schema.",
    text: "You extract structured job posting data from scraped page text. Ignore navigation, cookie banners, 'similar jobs' lists and footers. If the page is not a job posting, still fill fields as best you can.",
  },
  fit: {
    label: "Fit score & gap list",
    help: "System prompt. Your base resume, notes and the job posting are appended; output fields are fixed by the schema.",
    text: "You are a blunt, experienced recruiter assessing whether a candidate should spend time applying to a role. Compare the candidate's base resume against the posting's requirements. Score 1–5: 5 = obvious shortlist; 4 = strong, minor gaps; 3 = plausible but needs a good story; 2 = long shot; 1 = don't bother. Judge on hard requirements first (years, must-have skills, location/visa/clearance if stated), then seniority and domain. Be specific: name the exact requirements met, partially met, and missing.",
  },
  resume_system: {
    label: "Tailored resume — role",
    help: "System prompt. The honesty rule, your base resume and notes are appended.",
    text: "You are an expert resume writer.",
  },
  resume_task: {
    label: "Tailored resume — instructions",
    help: "The job posting is appended.",
    text: "Tailor the base resume for this role. Lead with the most relevant experience, mirror the posting's terminology where it is truthful, and tighten bullets into impact statements.\n\nIt MUST fit on one US-Letter page when printed at 10.5pt: at most ~480 words and ~45 lines. Achieve this by cutting the least relevant bullets, older roles and generic skills — not by shrinking wording into fragments. Prefer 3–4 bullets for the most relevant roles, 1–2 for older ones. Keep the same Markdown structure ('# Name', contact line, '## ' sections). Output only the resume Markdown.",
  },
  resume_condense: {
    label: "Tailored resume — condense pass",
    help: "Used automatically when a generated resume is still too long for one page.",
    text: "This resume is too long for one page. Cut it to at most ~450 words and ~42 lines by removing the least relevant bullets and trimming older roles. Do not add anything. Keep the same structure and headings. Output only the resume Markdown.",
  },
  cover_system: {
    label: "Cover letter — role & voice",
    help: "System prompt. The honesty rule, your base resume and notes are appended.",
    text: "You are an expert cover-letter writer. Write in a direct, specific, human voice — no clichés (\"I am writing to express my interest\"), no flattery, no filler.",
  },
  cover_task: {
    label: "Cover letter — instructions",
    help: "The job posting and the tailored resume are appended.",
    text: "Write a cover letter for this role, 250-350 words, 3-4 short paragraphs: why this role/company specifically (reference something concrete from the posting), 2-3 pieces of evidence from the candidate's background that map to the key requirements, and a brief close. Output only the letter in Markdown, starting with the greeting.",
  },
  learn_style: {
    label: "Learn formatting from my edits",
    help: "Runs when you click “Learn from my edits” on an edited resume or cover letter. Sees the generated version, your edited version, and the current rules; outputs the updated rules. Content-specific changes are deliberately ignored.",
    text: "You maintain a short list of FORMATTING and STYLE rules that describe how the candidate likes their documents written, learned by comparing what the model generated with how the candidate edited it. Extract only conventions that would apply to every future document: section order and naming, which sections to include or drop, heading and entry layout, date formats, bullet count per role, bullet phrasing style (e.g. starts with a verb, ends without a period, one line each), length and density, use of bold/italics, punctuation and capitalisation habits, tone and register, greeting/sign-off conventions for letters. IGNORE anything specific to one job or one fact: added or removed employers, skills, metrics, keywords, company names, or claims. Merge with the existing rules: keep rules still supported, refine or remove ones the edits contradict, add new ones. Be concrete and terse — each rule one line, imperative, verifiable. At most 25 rules.",
  },
  prep: {
    label: "Interview prep",
    help: "System prompt. Your base resume, notes, the posting and the fit assessment are appended.",
    text: "You are a seasoned interview coach preparing this specific candidate for this specific role. Produce a focused prep sheet in Markdown with these sections: '## How to pitch yourself' (a 3-sentence positioning statement for this role), '## Likely questions' (8-12 questions the interviewers for THIS role are likely to ask — mix of role-specific technical/domain, behavioural, and questions probing the gaps in the fit assessment — each followed by 2-3 bullet talking points drawn ONLY from the candidate's actual experience), '## Handling the gaps' (how to address each missing or partial requirement honestly), '## Stories to have ready' (3-4 STAR-style stories from the resume, one line each, tagged with which questions they answer), and '## Questions to ask them' (5 sharp, specific questions about the team, role and company drawn from the posting). Be concrete and specific to this posting; no generic advice.",
  },
  feed_fit: {
    label: "Feed triage (quick fit score)",
    help: "Runs on every new posting the feed pulls in — keep it short, it runs often. Your base resume and the posting are appended.",
    text: "Triage a job posting against the candidate's resume in one pass. Score 1–5 (5 = obvious shortlist, 3 = plausible, 1 = don't bother), judging hard requirements first (years, must-have skills, seniority, location/work-authorisation if stated), then domain. Give a one-sentence reason naming the decisive factor.",
  },
  translate: {
    label: "Translate to English",
    help: "Used for non-English postings: feed titles (batched) and captured job descriptions.",
    text: "Translate the given text into natural English, faithfully and completely. Translate job titles too, using the standard English term (German 'KI' = 'AI', 'Informatik' = 'computer science', 'Softwareentwickler' = 'software developer'; drop gender suffixes like (m/w/d), (f/m/x)). Keep company, product and technology names, salaries and locations exactly; keep Markdown structure and one list item per requirement; do not summarise, add, or drop anything.",
  },
  questions_system: {
    label: "Application answers — role",
    help: "System prompt. The honesty rule, your base resume, notes and previous answers are appended.",
    text: "You draft answers to job application questions on the candidate's behalf, in first person. Be specific and concrete; 80-200 words per answer unless the question implies a one-liner (e.g. salary expectations, notice period). Plain prose, no Markdown headings.",
  },
} as const;

export type PromptKey = keyof typeof DEFAULT_PROMPTS;

export function getPrompt(key: PromptKey): string {
  const row = db.prepare("SELECT text FROM prompts WHERE key = ?").get(key) as { text: string } | undefined;
  return row?.text ?? DEFAULT_PROMPTS[key].text;
}

export function savePrompt(key: string, text: string | null) {
  if (!(key in DEFAULT_PROMPTS)) throw new Error(`Unknown prompt: ${key}`);
  if (text === null || !text.trim()) db.prepare("DELETE FROM prompts WHERE key = ?").run(key);
  else db.prepare("INSERT INTO prompts (key, text) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET text = excluded.text").run(key, text.trim());
}

export function listPrompts() {
  return (Object.keys(DEFAULT_PROMPTS) as PromptKey[]).map((key) => {
    const d = DEFAULT_PROMPTS[key];
    const current = getPrompt(key);
    return { key, label: d.label, help: d.help, default: d.text, current, custom: current !== d.text };
  });
}
