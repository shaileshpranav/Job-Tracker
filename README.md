# Job Tracker

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522.6-brightgreen)

Local job-application tracker with Claude doing the repetitive work:

- **Capture** — paste a posting URL; company, role, location, salary, requirements and any application questions are extracted and logged.
- **Tailor** — a resume variant and cover letter are written from your base resume for that specific posting (no invented facts), saved with the application, and printable to PDF.
- **Answer** — paste the form's questions; answers are drafted from your profile and reuse what you've said on earlier applications.
- **Track** — status pipeline, applied date, notes, timeline. Everything is also mirrored as Markdown under `applications/`.

## Setup

```bash
git clone https://github.com/shaileshpranav/Job-Tracker.git
cd Job-Tracker
npm install
cp .env.example .env        # add an API key (or use Ollama — no key needed)
# drop resume.pdf or resume.docx into profile/
npm start                    # http://localhost:4321
```

Everything the app writes — your resume, tracked applications, and the SQLite database — lives
under `profile/`, `applications/` and `data/`, all gitignored; nothing you enter ever gets
committed or leaves your machine on its own.

## Capturing postings that block scrapers (LinkedIn, Workday, …)

The home screen has a **Save to Job Tracker** bookmarklet. Drag it to your bookmarks bar; click it while viewing a posting in your normal, logged-in browser. It sends the page *as rendered* to the app (which must be running) and opens the new application — no scraping, so nothing gets blocked. The original page text is kept with the application, so **↻ Re-extract** on the Job tab can re-run extraction later with a better model, and **↻ Fetch again** re-scrapes the URL. Entries that look thin (no location/requirements) get a hint banner pointing at these.

## Getting around

- **Sidebar nav** (desktop) / **bottom bar** (phone): Home · Feed · Goals · Tasks · Settings — badges show hot feed postings and running tasks. On a phone there's also **Apps** for the list, since Home is the dashboard.
- **Home** is a dashboard: a setup checklist until everything's configured, today's numbers (applied vs goal, follow-ups due, hot postings, running tasks), what needs attention, and recent activity; the bookmarklet, answer bank and backups live in collapsible sections below.
- The list can be sorted (Recent · Fit · Applied · A–Z) and filtered by status or due follow-ups; each row carries a stage marker and rail that darken as the application moves through the pipeline (saved is an outline, offer is green, rejected rust).
- Keyboard: `n` new, `/` search, `j`/`k` next/previous application, `1`–`6` tabs, `⌘S` save, `Esc` back, `?` for the list. **`⌘K`** opens a palette to jump to any application, view, settings section or action. In the feed, `j`/`k` move a highlight and `t` / `x` / `o` / `s` track, remove, open the posting or score the highlighted one.
- **Undo instead of dialogs**: deleting an application, removing an answer or a feed posting happens immediately with an *Undo* in the notice; the server change follows a few seconds later (or not at all if you undo).
- On a phone the application header folds: one status chip (tap to change) and a one-line summary of dates, next action and notes (tap *edit* to open the controls). A next action that is due shows in amber, in the header and the list.
- **New application** has two modes: **Capture a posting** (URL / pasted text, model extraction) and **Log by hand** — company, role, status and date only, no model — for Easy Apply, referrals, or applications made before the tracker existed; it counts towards goals like any other.
- Background refreshes never move your scroll position or steal focus; progress shows as a small pill top-right.

## Appearance

Follows your system light/dark setting; the half-circle button at the bottom of the sidebar overrides it (remembered per browser). All colours come from CSS tokens at the top of `src/public/index.html`; the stage ramp is `--st-saved` … `--st-withdrawn`. Type is IBM Plex (Sans for the interface, Serif for the names of things, Mono for dates and file names), served from `src/public/fonts/` so nothing is fetched from the network.

## Using it from your phone

The UI is responsive — on a phone the list and the application detail become separate screens with a back button. The server listens on all interfaces by default, so with your phone on the same Wi-Fi, open the "on your phone" URL that `npm start` prints (e.g. `http://192.168.0.109:4321`). Add it to your home screen from Safari's share sheet for an app-like experience. To keep the server local-only, set `HOST=127.0.0.1` in `.env`.

## Security

The server has no login by default and listens on all interfaces, so on shared Wi-Fi anyone on the network can open it. Set `AUTH_PASSWORD` in `.env`, or add a password from **Settings → Security** once it's running, to require one — a session then lasts 30 days per browser (the log-out button at the bottom of the sidebar ends it). Saved LLM API keys are encrypted at rest in `data/tracker.db` with a key generated on first run at `data/secret.key`; back both files up together, since losing the key file just means re-pasting keys in Settings, not losing the tracker data.

## Settings

Settings is split into sections (list on the left; a chip row on phones): **Model** (provider, key, default model), **Per-task models**, **Quality guard**, **Base resumes**, **Documents** (PDF file names, LaTeX templates, learned formatting rules), **Prompts** and **Security**. The list marks what needs attention — a red dot when the chosen provider has no key, a count of unreliable routes on the guard, an amber dot when no password is set. The section you were on is remembered.

## Choosing a model

Open **Settings** in the app: pick a provider, paste its API key (stored locally in `data/tracker.db`, takes effect immediately), and choose a model from the searchable list. `.env` values (`LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_HOST`) act as defaults; anything set in the app wins.

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

- click the **Save to Job Tracker** bookmarklet on the cleared page — the waiting task for that site resumes automatically with what you saw, or
- paste the page text into the card.

There is also **I've cleared it — try again**, which simply re-fetches (useful after a rate limit passes). The page text you hand over is stored with the task, so a retry does not need to fetch again.

## Goals, streaks and achievements

The goal bar under the sidebar header shows today's progress and your streak; click it for the **Goals** view. Set targets per day / week / month (0 = ignore) and whether weekends count — with weekends off, Saturday and Sunday are rest days that don't break a streak. Everything is derived from each application's **applied** date (set automatically when you move a card to *applied*, or edit it in the header), so correcting a date recomputes it all.

- **Rings** for today, this week (Mon–Sun) and this month.
- **Streak** — consecutive days hitting the daily target (still alive if yesterday hit and today is in progress); best streak is kept.
- **XP and levels** — 10 per application, +25 per daily goal, +75 per weekly, +200 per monthly, +5 per streak day. Rookie → Applicant → Contender → Hunter → Closer → Relentless → Unstoppable → Legend.
- **Heatmap** of the last 16 weeks.
- **Achievements** for milestones (first application, power day, streaks of 3/7/14/30, weekly and monthly wins, 10/25/50/100 sent, five 4+-fit applications, reaching screening / interview / offer, levels 3 and 5). Unlocks are announced as they happen.
- **What's working** (once you have a few sent) — of the applications you've sent, what share ever reached screening/interview/offer, broken down by base resume and by fit score; a rejection after an interview still counts as having advanced. Meant to answer "is this resume/targeting actually landing", not just "did I hit my numbers."

## Job feed

**Feed** in the sidebar. Sources are official JSON endpoints — no HTML scraping:

- **Company boards** — paste any careers URL (or just the company's site) into **Find board** and the app resolves it to `greenhouse:<token>`, `lever:<token>`, `ashby:<token>`, `workable:<account>` or `smartrecruiters:<Company>`, checks it responds, and shows sample titles before you add it. JS-rendered careers pages are handled by trying the company's domain name as the token (flagged as a guess — check the titles).
- **Aggregators** — Arbeitnow (Europe), RemoteOK, Remotive, **HN "Who is hiring"** (the monthly thread, one posting per comment), The Muse, Himalayas, Jobicy, and Adzuna (free key; covers Singapore, Germany, UK, US and more — countries are derived from your locations).

Filtering: keywords (all words of a line must appear in the title, or title + description), locations ("remote" matches remote roles; a country also matches its short forms and its major cities — "Germany" covers Berlin / Munich / "Berlin, DE", "United States" covers USA / US / U.S. / "City, ST" with a US state code, "United Kingdom" covers UK / London / England…), an exclude list (whole words on the title, so "intern" doesn't hide "Internal Tools"; same country logic on the location), **career levels** (intern / junior / mid / senior / staff / principal / lead / manager, classified from the title), and a maximum posting age. **Non-English postings** are detected and their titles translated in batches before keyword matching (shown as `DE → EN`, original on hover); a captured non-English posting is translated in full — role, description, requirements — with the original kept as source text, and there's a **🌐 Translate** button on the Job tab for anything captured another way. Translation is its own routable task; switch it off in the feed settings. Duplicates collapse across sources by URL and by normalised company + title, and anything you've already tracked is skipped.

Filters apply to what is already in the feed, not just to new fetches: saving the settings (and every refresh) re-checks every open posting, hides the ones that no longer pass under a **Hidden by filters** chip, and brings them back automatically when a filter is loosened — scores are kept either way.

Scoring is two-stage: every new posting is **keyword-screened** against your base resume(s) for free (deterministic ATS coverage, shown as a % chip with the missing terms); only postings above the coverage floor go to the **Feed triage** model, best-covered first, up to a per-refresh cap. Score ≥ threshold → **🔥 Hot**; the nav badge counts hot postings you haven't looked at yet. Each row has a **Preview** of the description; **Track** creates a full application (extraction + fit) and links back; bulk actions **Track all hot**, **Dismiss below threshold**, **Dismiss screened-out**. Stale items are purged automatically. Refresh by hand or every N hours.

Storage folders can be moved with `DATA_DIR`, `APPLICATIONS_DIR`, `PROFILE_DIR` in `.env` (handy for a second instance or a synced folder).

## Applying

**Apply** in an application's header opens the apply pack: the current resume and cover letter PDFs with their real page counts (a ✗ and a Generate button if one is missing), **Copy all answers** (every question and answer as plain text, for ATS forms), a **Fill this application** bookmarklet, and **Show in Finder**, which rebuilds any stale PDF, writes `questions.md`, and opens the application's folder so you can drag files into the upload fields. Below that, *Applied on* (today) and *Follow up on* (today + the Goals nudge, default 7 days; left empty when the nudge is 0) are prefilled; **✓ Mark as applied** sets the status, dates and next action in one go. After that the same button reads *📦 Apply pack* so the files stay one click away.

**Fill application form** — a bookmarklet from Home (drag once), clicked on the company's actual application form rather than the posting. It works out which application the form belongs to from the page's address — the exact posting URL if you captured it, or the one open application on that employer's site — and asks you to pick when that's ambiguous; the copy pinned to one application (in its apply pack, *Fill this application*) skips the guess. It fills name/email/phone/LinkedIn/GitHub/site, attaches the current resume and cover letter PDFs to file-upload fields, drops your cover letter text into a cover-letter box, and matches this application's saved answers — and, more loosely, anything answered on other applications — to nearby fields by label text, filling only what it's confident about (highlighted in the accent colour) and never overwriting a field that already has a value. Questions on the page it can't answer send themselves back to Job Tracker with one click to draft from your resume and prior answers; click Fill again once they're ready. Nothing is guessed or invented, and it never touches the submit button. It authenticates cross-origin with a signed token baked into the bookmarklet rather than your session cookie, so it keeps working with a password set — changing the password revokes old copies, so drag a fresh one after.

## Capturing the same posting twice

Capture checks the URL (ignoring `utm_*`, `ref`, tracking parameters, `www.` and trailing slashes) and, for pasted descriptions, company + role against what you already track. A match shows *Already tracked: Company · Role (status, captured/applied date)* with **Open it** and **Capture anyway** instead of quietly creating a second application; the bookmarklet goes through the same check. Tracking a feed item whose URL you captured by hand earlier just links the two (URL only — the same title at the same company is not assumed to be the same posting); **Track all hot** does the same per item.

## Before a task is queued

Every queued task (one hook in front of the queue, so no route can forget it) checks its task's provider first and refuses with a plain message rather than queuing a task that would die a minute later: Ollama not reachable (with the `ollama serve` hint), the routed model not pulled (`ollama pull …`), or a hosted provider with no API key. The check names the task and the model it's routed to, so a wrong per-task route is obvious.

## Follow-ups, notes and interview prep

- **Next action** — each application has a date + note in its header; when the date arrives it shows as due in the list and under the **follow up** filter. Applications sitting in *applied*/*screening* with no reply for N days (Goals → "nudge me after", default 7) are flagged the same way. **✓ Followed up** logs it and clears the flag; ☎ Call / 🤝 Interview log those.
- **Timeline** — add free-text notes (recruiter names, what was said); hand-logged entries can be removed.
- **Prep tab** — generates an interview prep sheet for *this* role: positioning pitch, likely questions with talking points from your own experience, how to handle the gaps the fit score found, STAR stories to have ready, and questions to ask them. Saved as `interview-prep.md`.
- **Compare** (Resume / Cover letter tabs) — line diff of the current version against the base resume or any earlier version; the fastest way to spot anything the model invented or dropped.
- **Backup & export** (home screen) — `.tar.gz` of the database, application folders, base resume, templates and secret key; CSV of all applications.

## Model quality guard

Every model result is sanity-checked before it's used: structured outputs for placeholder values (`O-7`, `string`, `N/A`, leaked JSON, repeated tokens), empty required fields, descriptions far shorter than the page they came from, too-short answers; long-form documents for template residue and minimum length. When a result fails, the failure is recorded against that model and the call is **retried once on a fallback** — the one you set in **Settings → Quality guard**, or automatically the strongest model already in your routing (or Anthropic directly if a key is present). The Settings card shows a per-model reliability table; any task routed to a model that has returned junk in ≥30% of calls gets an ⚠ badge. The guard can be switched off.

## Tasks queue

Every model-backed action — capture, re-extract, fit score, resume/cover letter, condense, answers, resume import — is queued as a **task** and runs in the background, one at a time (set `JOB_CONCURRENCY=2` in `.env` to allow more if you're on hosted models). Buttons return instantly; the ⏱ button shows how many tasks are active and opens the Tasks panel with live progress, history, **Cancel** (queued tasks stop immediately; running ones stop at their next step) and **Retry**. The tab you're on shows an inline "working…" banner for its own tasks, and the app refreshes itself when a task finishes. Tasks are stored in SQLite, so a queue survives a restart (anything mid-flight when the server stopped is marked failed for retry).

## Base resumes

`profile/resume.md` is the default base. Add more as `profile/resume-<name>.md` (or drop `resume-<name>.pdf` and import it from **Settings → Base resumes**; you can also create one there as a copy of another and edit it in place). A first-line `<!-- label: Platform / backend -->` names it. With more than one base, **fit scoring runs against each** and the application uses the best-scoring one for tailoring, cover letters, answers and prep; the fit card shows every base's score and lets you pin a different one.

## ATS keyword check

On the Resume tab, above the document: a deterministic comparison (no model) of the current resume version — or the base resume before you generate — against the posting. Terms come from the extracted requirements (*required*) and technical terms in the description; aliases such as Postgres/PostgreSQL and k8s/Kubernetes count. Shows required and overall coverage, what's missing, what's found and how often, and flags keyword stuffing. **Regenerate with the missing required terms** asks the model to use those exact terms where truthful.

## Fit score

Every captured posting is scored 1–5 against `profile/resume.md` in the background (★ badge in the sidebar; full card at the top of the Job tab): verdict, requirements **met / partial / missing**, and advice on framing. Use it to decide whether an application is worth the time. **↻ Re-score** after editing your base resume. Prompt is editable under Settings → Prompts; the model under Per-task models ("Fit score & gap list").

## Documents

- **File names.** Exported PDFs are named for the recruiter: `Shailesh-Pranav-Rajendran-Resume.pdf` / `…-Cover-Letter.pdf`, with the name taken from the heading of the base resume the application uses (ALL CAPS is title-cased). The pattern is editable in **Settings → Documents** with `{name}`, `{kind}` and `{company}` placeholders (`{kind}` is appended if a pattern omits it, so a resume and cover letter never share a file); the same name is used for the file in the application folder, the download, and the browser print fallback's suggested name. The apply pack shows the exact name next to each document.
- **PDF export via LaTeX.** Markdown stays the source of truth; `src/latex.ts` converts it deterministically (no model in the loop, so nothing can break the TeX) into `templates/resume.tex` / `templates/letter.tex` and compiles with `xelatex` via `latexmk`. Needs MacTeX or BasicTeX (`brew install --cask basictex`); without it the app falls back to browser print. Edit the templates to change the look; `/doc/<id>.tex` shows the generated TeX if you want to tweak by hand in Overleaf.
- **LaTeX mode** on a document tab shows the full generated `.tex`; edit spacing/margins/font size and **Save & rebuild PDF** — the page count updates from the real compile. "Reset to generated" goes back to the Markdown-derived TeX; saving Markdown edits also regenerates it. **Settings → Documents → PDF templates** edits the global templates instead.
- **Learn my format** — after you edit and save a generated resume or cover letter, this compares your version with the generated one and updates a short list of *formatting* rules (section order/names, bullet style, date format, length, tone, sign-offs…) that every future document follows. Content changes — facts, skills, employers, job-specific wording — are deliberately ignored. Rules live under **Settings → Documents → Learned formatting preferences**, per document type, and are editable/clearable.
- **Instructions for the next draft** — the box under Generate takes free text (*"shorter"*, *"lead with the Monta work"*, *"mention I'm open to relocating"*) and passes it to the model for that draft; on the Resume tab, **Resume + cover letter** applies it to both. It outranks the learned formatting rules but never the honesty rules. The instructions are stored with the version they produced (shown as a ✎ pill and in the timeline), and the box stays prefilled so you can iterate; Condense carries them over.
- **Unsaved edits are never lost.** Switching tabs, view modes or applications while editing Markdown, LaTeX, job details or an answer keeps the edit as a draft (persisted in the browser, so it survives a reload); the tab shows ✎ and the document a "You have unsaved edits — Continue editing / Discard" banner. A field with a draft has an amber border and its Save button lights up. Drafts clear when you save or discard; **Cancel** on the job-details form discards. An edit made to a version that a regenerate has since replaced is kept too — the tab offers to restore it into the current version's editor or discard it. The same applies to a half-written New application form.
- **Versions.** Every generate, condense, restore and save keeps the earlier text. The `vN of M ▾` chip on a document lists them; **View** shows an earlier version (preview, PDF, compare, copy) and **↩ Restore as vM+1** brings it back as the newest — nothing is ever overwritten.
- **Condense to one page** on the Resume tab asks the model to cut the current version down (saved as a new version, so nothing is lost).
- Generated resumes are constrained to **one page**: the draft is compiled, and if the real page count is > 1 an automatic condense pass trims it and recompiles. The Resume tab shows `N page(s) (PDF)` from the actual compile; without LaTeX it falls back to a word/line heuristic.
- Resume and cover-letter tabs default to a rendered **Preview**; **PDF** shows the compiled page inline (compiling it first if needed, with the build error shown if LaTeX fails); switch to **Edit** to change the Markdown, then Save.
- **⎘ Copy text** (Export) copies the document as plain text — headings and emphasis markers dropped, bullets kept — for application forms that want the cover letter or resume pasted in. The Questions tab and the apply pack have **Copy all answers**.
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

## Contributing

Issues and PRs are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, code
conventions, and what kinds of changes fit the project's scope. [`CLAUDE.md`](CLAUDE.md) has the
fuller architecture notes if you're making a structural change.

## Security

This is a local, single-user app with no telemetry — see the **Security** section above for what's
protected and how. To report a vulnerability, see [`SECURITY.md`](SECURITY.md) rather than opening
a public issue.

## License

[GPL-3.0](LICENSE) — see the `LICENSE` file for the full text.
