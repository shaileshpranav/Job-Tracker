# Job Tracker

Local job-application tracker with Claude doing the repetitive work:

- **Capture** — paste a posting URL; company, role, location, salary, requirements and any application questions are extracted and logged.
- **Tailor** — a resume variant and cover letter are written from your base resume for that specific posting (no invented facts), saved with the application, and printable to PDF.
- **Answer** — paste the form's questions; answers are drafted from your profile and reuse what you've said on earlier applications.
- **Track** — status pipeline, applied date, notes, timeline. Everything is also mirrored as Markdown under `applications/`.

## Setup

```bash
npm install
cp .env.example .env        # add an API key (or use Ollama — no key needed)
# drop resume.pdf or resume.docx into profile/
npm start                    # http://localhost:4321
```

## Capturing postings that block scrapers (LinkedIn, Workday, …)

The home screen has a **📌 Save to Job Tracker** bookmarklet. Drag it to your bookmarks bar; click it while viewing a posting in your normal, logged-in browser. It sends the page *as rendered* to the app (which must be running) and opens the new application — no scraping, so nothing gets blocked. The original page text is kept with the application, so **↻ Re-extract** on the Job tab can re-run extraction later with a better model, and **↻ Fetch again** re-scrapes the URL. Entries that look thin (no location/requirements) get a hint banner pointing at these.

## Getting around

- **Sidebar nav** (desktop) / **bottom bar** (phone): Home · Feed · Goals · Tasks · Settings — badges show hot feed postings and running tasks. On a phone there's also **Apps** for the list, since Home is the dashboard.
- **Home** is a dashboard: a setup checklist until everything's configured, today's numbers (applied vs goal, follow-ups due, hot postings, running tasks), what needs attention, and recent activity; the bookmarklet, answer bank and backups live in collapsible sections below.
- The list can be sorted (Recent · Fit · Applied · A–Z) and filtered by status or ⏰ follow-ups; rows carry a colour bar for the stage.
- Keyboard: `n` new, `/` search, `j`/`k` next/previous application, `1`–`6` tabs, `⌘S` save, `Esc` back, `?` for the list.
- Background refreshes never move your scroll position or steal focus; progress shows as a small pill top-right.

## Appearance

Follows your system light/dark setting; the ◐ button at the bottom of the sidebar overrides it (remembered per browser). All colours come from CSS tokens at the top of `src/public/index.html`.

## Using it from your phone

The UI is responsive — on a phone the list and the application detail become separate screens with a back button. The server listens on all interfaces by default, so with your phone on the same Wi-Fi, open the "on your phone" URL that `npm start` prints (e.g. `http://192.168.0.109:4321`). Add it to your home screen from Safari's share sheet for an app-like experience. To keep the server local-only, set `HOST=127.0.0.1` in `.env`.

## Security

The server has no login by default and listens on all interfaces, so on shared Wi-Fi anyone on the network can open it. Set `AUTH_PASSWORD` in `.env`, or add a password from **⚙ Settings → Security** once it's running, to require one — a session then lasts 30 days per browser (**⎋** in the sidebar logs out). Saved LLM API keys are encrypted at rest in `data/tracker.db` with a key generated on first run at `data/secret.key`; back both files up together, since losing the key file just means re-pasting keys in Settings, not losing the tracker data.

## Choosing a model

Open **⚙ Settings** in the app: pick a provider, paste its API key (stored locally in `data/tracker.db`, takes effect immediately), and choose a model from the searchable list. `.env` values (`LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_HOST`) act as defaults; anything set in the app wins.

| Provider | Needs | Notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | Best results. Native PDF reading, guaranteed structured output, and a server-side web-fetch fallback for postings that block scrapers. |
| `openrouter` | `OPENROUTER_API_KEY` | Any model on openrouter.ai by id (`anthropic/claude-opus-5`, `openai/gpt-5`, `google/gemini-2.5-pro`, …). "Load available models" lists them all. |
| `ollama` | Ollama running locally | Fully offline; nothing leaves your machine. `ollama pull <model>` then pick it. 7B+ models give usable drafts; small ones are rough. |

**Per-task models:** the second card in Settings routes individual tasks (capture, resume import, tailored resume, cover letter, answers) to their own provider/model — e.g. a free local model for capture and extraction, a strong hosted model for the writing. Tasks left on "default" use the default model.

For OpenRouter and Ollama, PDFs are text-extracted locally (`pdf-parse`) before being sent to the model, and structured extraction uses JSON-schema output with a prompt-only fallback for models that don't support constrained decoding.

Requires Node 22.6+ (uses built-in SQLite and TypeScript type-stripping — no build step).

On first visit, click **Import resume** to convert your PDF/DOCX into `profile/resume.md`. That Markdown file is the source of truth for all tailoring — edit it to improve every future document. Optional `profile/notes.md` for anything else Claude should know (goals, tone, things to emphasise).

## When a site asks for a human

Some postings sit behind a Cloudflare check, a CAPTCHA, or a sign-in wall. The app **never tries to solve or bypass these**. It detects the challenge, parks the task as **waiting**, and shows a card with the site and the reason. You open the posting in your own browser, clear the check yourself, then hand the page over either way:

- click the 📌 **Save to Job Tracker** bookmarklet on the cleared page — the waiting task for that site resumes automatically with what you saw, or
- paste the page text into the card.

There is also **I've cleared it — try again**, which simply re-fetches (useful after a rate limit passes). The page text you hand over is stored with the task, so a retry does not need to fetch again.

## Goals, streaks and achievements

The 🎯 bar under the sidebar header shows today's progress and your streak; click it for the **Goals** view. Set targets per day / week / month (0 = ignore) and whether weekends count — with weekends off, Saturday and Sunday are rest days that don't break a streak. Everything is derived from each application's **applied** date (set automatically when you move a card to *applied*, or edit it in the header), so correcting a date recomputes it all.

- **Rings** for today, this week (Mon–Sun) and this month.
- **Streak** — consecutive days hitting the daily target (still alive if yesterday hit and today is in progress); best streak is kept.
- **XP and levels** — 10 per application, +25 per daily goal, +75 per weekly, +200 per monthly, +5 per streak day. Rookie → Applicant → Contender → Hunter → Closer → Relentless → Unstoppable → Legend.
- **Heatmap** of the last 16 weeks.
- **Achievements** for milestones (first application, power day, streaks of 3/7/14/30, weekly and monthly wins, 10/25/50/100 sent, five 4+-fit applications, reaching screening / interview / offer, levels 3 and 5). Unlocks are announced as they happen.

## Job feed

📡 in the sidebar. Sources are official JSON endpoints — no HTML scraping:

- **Company boards** — paste any careers URL (or just the company's site) into **Find board** and the app resolves it to `greenhouse:<token>`, `lever:<token>`, `ashby:<token>`, `workable:<account>` or `smartrecruiters:<Company>`, checks it responds, and shows sample titles before you add it. JS-rendered careers pages are handled by trying the company's domain name as the token (flagged as a guess — check the titles).
- **Aggregators** — Arbeitnow (Europe), RemoteOK, Remotive, **HN "Who is hiring"** (the monthly thread, one posting per comment), The Muse, Himalayas, Jobicy, and Adzuna (free key; covers Singapore, Germany, UK, US and more — countries are derived from your locations).

Filtering: keywords (all words of a line must appear in the title, or title + description), locations ("remote" matches remote roles), an exclude list, and a maximum posting age. Duplicates collapse across sources by URL and by normalised company + title, and anything you've already tracked is skipped.

Scoring is two-stage: every new posting is **keyword-screened** against your base resume(s) for free (deterministic ATS coverage, shown as a % chip with the missing terms); only postings above the coverage floor go to the **Feed triage** model, best-covered first, up to a per-refresh cap. Score ≥ threshold → **🔥 Hot**; the nav badge counts hot postings you haven't looked at yet. Each row has a **Preview** of the description; **Track** creates a full application (extraction + fit) and links back; bulk actions **Track all hot**, **Dismiss below threshold**, **Dismiss screened-out**. Stale items are purged automatically. Refresh by hand or every N hours.

Storage folders can be moved with `DATA_DIR`, `APPLICATIONS_DIR`, `PROFILE_DIR` in `.env` (handy for a second instance or a synced folder).

## Follow-ups, notes and interview prep

- **Next action** — each application has a date + note in its header; when the date arrives it shows ⏰ in the list and under the **follow up** filter. Applications sitting in *applied*/*screening* with no reply for N days (Goals → "nudge me after", default 7) are flagged the same way. **✓ Followed up** logs it and clears the flag; ☎ Call / 🤝 Interview log those.
- **Timeline** — add free-text notes (recruiter names, what was said); hand-logged entries can be removed.
- **Prep tab** — generates an interview prep sheet for *this* role: positioning pitch, likely questions with talking points from your own experience, how to handle the gaps the fit score found, STAR stories to have ready, and questions to ask them. Saved as `interview-prep.md`.
- **Compare** (Resume / Cover letter tabs) — line diff of the current version against the base resume or any earlier version; the fastest way to spot anything the model invented or dropped.
- **Backup & export** (home screen) — `.tar.gz` of the database, application folders, base resume, templates and secret key; CSV of all applications.

## Model quality guard

Every model result is sanity-checked before it's used: structured outputs for placeholder values (`O-7`, `string`, `N/A`, leaked JSON, repeated tokens), empty required fields, descriptions far shorter than the page they came from, too-short answers; long-form documents for template residue and minimum length. When a result fails, the failure is recorded against that model and the call is **retried once on a fallback** — the one you set in **Settings → Model quality guard**, or automatically the strongest model already in your routing (or Anthropic directly if a key is present). The Settings card shows a per-model reliability table; any task routed to a model that has returned junk in ≥30% of calls gets an ⚠ badge. The guard can be switched off.

## Tasks queue

Every model-backed action — capture, re-extract, fit score, resume/cover letter, condense, answers, resume import — is queued as a **task** and runs in the background, one at a time (set `JOB_CONCURRENCY=2` in `.env` to allow more if you're on hosted models). Buttons return instantly; the ⏱ button shows how many tasks are active and opens the Tasks panel with live progress, history, **Cancel** (queued tasks stop immediately; running ones stop at their next step) and **Retry**. The tab you're on shows an inline "working…" banner for its own tasks, and the app refreshes itself when a task finishes. Tasks are stored in SQLite, so a queue survives a restart (anything mid-flight when the server stopped is marked failed for retry).

## Base resumes

`profile/resume.md` is the default base. Add more as `profile/resume-<name>.md` (or drop `resume-<name>.pdf` and import it from **Settings → Base resumes**; you can also create one there as a copy of another and edit it in place). A first-line `<!-- label: Platform / backend -->` names it. With more than one base, **fit scoring runs against each** and the application uses the best-scoring one for tailoring, cover letters, answers and prep; the fit card shows every base's score and lets you pin a different one.

## ATS keyword check

On the Resume tab, above the document: a deterministic comparison (no model) of the current resume version — or the base resume before you generate — against the posting. Terms come from the extracted requirements (*required*) and technical terms in the description; aliases such as Postgres/PostgreSQL and k8s/Kubernetes count. Shows required and overall coverage, what's missing, what's found and how often, and flags keyword stuffing. **Regenerate with the missing required terms** asks the model to use those exact terms where truthful.

## Fit score

Every captured posting is scored 1–5 against `profile/resume.md` in the background (★ badge in the sidebar; full card at the top of the Job tab): verdict, requirements **met / partial / missing**, and advice on framing. Use it to decide whether an application is worth the time. **↻ Re-score** after editing your base resume. Prompt is editable under Settings → Prompts; the model under Per-task models ("Fit score & gap list").

## Documents

- **PDF export via LaTeX.** Markdown stays the source of truth; `src/latex.ts` converts it deterministically (no model in the loop, so nothing can break the TeX) into `templates/resume.tex` / `templates/letter.tex` and compiles with `xelatex` via `latexmk`. Needs MacTeX or BasicTeX (`brew install --cask basictex`); without it the app falls back to browser print. Edit the templates to change the look; `/doc/<id>.tex` shows the generated TeX if you want to tweak by hand in Overleaf.
- **LaTeX mode** on a document tab shows the full generated `.tex`; edit spacing/margins/font size and **Save & rebuild PDF** — the page count updates from the real compile. "Reset to generated" goes back to the Markdown-derived TeX; saving Markdown edits also regenerates it. **Settings → PDF templates** edits the global templates instead.
- **🎓 Learn format from my edits** — after you edit and save a generated resume or cover letter, this compares your version with the generated one and updates a short list of *formatting* rules (section order/names, bullet style, date format, length, tone, sign-offs…) that every future document follows. Content changes — facts, skills, employers, job-specific wording — are deliberately ignored. Rules live under **Settings → Learned formatting preferences**, per document type, and are editable/clearable.
- **✂ Condense to one page** on the Resume tab asks the model to cut the current version down (saved as a new version, so nothing is lost).
- Generated resumes are constrained to **one page**: the draft is compiled, and if the real page count is > 1 an automatic condense pass trims it and recompiles. The Resume tab shows `N page(s) (PDF)` from the actual compile; without LaTeX it falls back to a word/line heuristic.
- Resume and cover-letter tabs default to a rendered **Preview**; switch to **Edit** to change the Markdown, then Save.
- **Settings → Prompts** lets you edit every instruction the app sends to the model (honesty rule, capture, import, resume, condense pass, cover letter, answers). Your resume, notes, the posting and prior answers are appended automatically; the editable part is just the instructions. "Reset to default" restores the shipped text.

## Layout

```
profile/        resume.pdf|docx  → resume.md (generated), notes.md (optional)
data/           tracker.db (SQLite)
applications/   001-company-role/{job.md, resume.md, cover-letter.md, questions.md}
src/
  server.ts     HTTP routes + JSON API
  auth.ts       optional login (session cookies, backoff); public/login.html
  http.ts       request helpers
  jobs.ts       background job handlers (capture, fit, generate, answers, …)
  documents.ts  per-application files: job.md, questions.md, LaTeX/PDF builds
  goals.ts      targets, streaks, XP, achievements
  ats.ts        deterministic ATS keyword check
  guard.ts      output sanity checks, per-model reliability, fallback retry
  feed.ts       job feed sources, filters, store
  crypto.ts     at-rest encryption for saved keys, password hashing
  queue.ts      persistent task queue + worker
  ai.ts         prompt assembly (extraction, tailoring, answers)
  prompts.ts    default prompt text + user overrides
  llm.ts        providers: Anthropic SDK · OpenRouter · Ollama (OpenAI-compatible)
  settings.ts   provider/model selection (DB, overrides .env)
  scrape.ts     posting fetch (local first, provider web-fetch fallback)
  profile.ts    resume import
  db.ts         schema
  latex.ts      Markdown → LaTeX → PDF (xelatex), page counting
  markdown.ts   print-ready HTML (browser-print fallback)
templates/      resume.tex, letter.tex — edit to restyle
  public/       UI
```

## Notes

- Anthropic default model is `claude-opus-5`, with server-side refusal fallback enabled.
- Sites that block scrapers (some LinkedIn/Workday pages): use the "paste the description" option under New.
- Deleting an application removes it from the database but leaves its folder on disk.
