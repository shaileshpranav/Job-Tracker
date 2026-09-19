# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm start          # run the server (http://localhost:4321), loads .env if present
npm run dev         # same, but restarts on file changes (node --watch)
npx tsc --noEmit    # type-check (tsconfig has noEmit: true — this is the only "build")
```

There is no build step, no bundler, and no test suite — Node 22.6+ runs `src/server.ts` directly via
native TypeScript type-stripping, and `src/db.ts` uses Node's built-in `node:sqlite`. The frontend
(`src/public/app.js`, `index.html`) is plain JS/HTML served as-is, no compile step there either.

`docker compose up` also works (see `Dockerfile`/`docker-compose.yml`) and runs the exact same
`node --env-file-if-exists=.env src/server.ts`, so it's a fine way to exercise a change too — the
image has no LaTeX, so PDF export there always uses the browser-print fallback.

To exercise a change, actually run `npm run dev` and hit the routes/UI — there's nothing else to
verify correctness.

## Architecture

This is a local-first job-application tracker: an HTTP server (`src/server.ts`) backed by SQLite,
a background job queue for anything that calls an LLM, and a single-page vanilla-JS frontend. See
`README.md` for full user-facing behavior; this section covers the parts that span multiple files.

### Request flow

`server.ts` is a single hand-rolled router (no framework): each route is an `if (m("METHOD", /regex/))`
check against `url.pathname`, matched top to bottom. Handlers call straight into the modules below and
respond via `send()`/`HttpError` from `http.ts`. Auth (`auth.ts`) gates everything except `isPublicRoute`
paths via a cookie session checked before routing.

### Background job queue (`queue.ts`)

Every LLM-backed action (capture, extraction, fit scoring, resume/cover-letter generation, condense,
answers, resume import, translation, feed triage) is a **job**: inserted into the `jobs` SQLite table,
run by an in-process worker pool (`JOB_CONCURRENCY`, default 1), progress-reported, and resumable after
a restart. Handlers are registered by type in `jobs.ts` via `registerJob(type, handler)` and looked up
by `pump()`/`runJob()` in `queue.ts`. A handler can throw `NeedsYou` to park the job as `waiting` when it
needs a human (e.g. a Cloudflare/CAPTCHA wall) instead of failing — `resumeJob`/`resumeMatching` re-queue
it once the user hands over what's missing (see the bookmarklet flow below).

Before a job is queued, `preflight.ts` checks whether its routed provider/model can actually answer
(Ollama reachable and model pulled, or a hosted provider has a key) and refuses synchronously with a
specific message rather than letting the job die in the queue.

### LLM provider layer

- `settings.ts` — provider/model selection, stored in the `settings` table, `.env` as fallback only.
  `TASKS` enumerates the routable task types (capture, fit, resume, cover_letter, questions, learn,
  prep, feed, translate, import); each can be routed to a different provider/model independently
  (`taskRoute`/`saveTaskRoute`) so e.g. capture can run on a free local model while writing tasks use a
  strong hosted one.
- `llm.ts` — the actual provider clients (Anthropic SDK, OpenRouter, Ollama via its OpenAI-compatible
  API), unified behind `getLLM(task)` / `getLLMFor(route)`.
- `ai.ts` — prompt assembly for extraction/tailoring; `prompts.ts` holds the default instruction text
  plus any user overrides (editable in Settings → Prompts), which `ai.ts` composes with the resume,
  posting and prior answers.
- `guard.ts` — sanity-checks every model result (placeholder values, empty required fields, suspiciously
  short output, template residue), tracks per-model reliability, and retries once on a configured
  fallback model when a result fails. Jobs run inside `withProgress()` from this module so guard checks
  can report progress too.

Adding a new LLM-backed feature means: add a task to `TASKS` in `settings.ts`, a prompt in `prompts.ts`,
a `registerJob` handler in `jobs.ts`, and a route in `server.ts` that enqueues it via `queueJob`
(`preflight.ts`) — the queue/guard/routing machinery is shared by all of them.

### Documents (`documents.ts`, `latex.ts`, `filenames.ts`)

Markdown is the source of truth for every resume/cover letter (`documents.content` in SQLite, mirrored
to the application's folder under `applications/`). `latex.ts` deterministically converts that Markdown
to `templates/resume.tex` / `letter.tex` and compiles with `xelatex`/`latexmk` (falls back to browser
print via `markdown.ts` if LaTeX isn't installed) — no model in this conversion step, so generation can
never corrupt the TeX. A document can also carry hand-edited TeX (`documents.tex`) that overrides the
generated version. **Versions are never overwritten**: every generate/condense/restore/save inserts a
new `documents` row; the UI's `vN of M` picker and restore-as-new-version behavior depend on this.
`filenames.ts` derives the recruiter-facing PDF file name from the base resume's heading + a
user-editable pattern.

### Storage layout

```
profile/    resume.pdf|docx → resume.md (source of truth), resume-<name>.md (alternate bases), notes.md
data/       tracker.db (SQLite: applications, documents, questions, events, jobs, settings, feed_items)
            secret.key (generated on first run; encrypts saved API keys/passwords via crypto.ts)
applications/<NNN-company-role>/   job.md, resume.md, cover-letter.md, questions.md, interview-prep.md
templates/  resume.tex, letter.tex — edit to restyle generated PDFs
```

`DATA_DIR` / `APPLICATIONS_DIR` / `PROFILE_DIR` env vars relocate any of these (see `db.ts`). Deleting
an application removes its DB row but leaves the folder on disk.

### Capture without scraping

Two bookmarklets (built server-side in `server.ts`/`autofill.ts`, dragged to the browser's bookmarks
bar) move data between the tracker and a site the user is already logged into, rather than scraping:
"Save to Job Tracker" POSTs the rendered page's text to `/api/captures` and opens the app to claim it
(`pendingCaptures` in `server.ts`); the per-application "Fill this application" bookmarklet reads
profile contact info and this application's saved answers and fills form fields by matching label text
client-side. When a captured page turns out to be behind a bot check, the job parks via `NeedsYou`
(see queue section above) and the same bookmarklet mechanism resumes it once the user clears the check.

### Extensions (`extensions.ts`)

User-installed connectors loaded from `extensions/` at startup (top-level `await` in the module, so
importing it yields a populated registry). An extension adds a board provider, an aggregator, and/or
a capture handler; `feed.ts` falls through to the registry when a `provider:token` or aggregator id
isn't built in, and `scrape.ts` offers each posting URL to extension capture handlers before its own
generic path. The bundled sources stay JSON-only on purpose — extensions are the documented escape
hatch for anything that can't meet that bar, so new scraper-shaped sources belong there, not in
`feed.ts`. Note `scrape.ts` imports `extensions.ts` dynamically: the dependency runs the other way
statically (extensions needs `htmlToText`/`jobPostingFromJsonLd`), and this avoids the cycle.

### Feed (`feed.ts`)

Pulls postings from JSON-only sources (Greenhouse/Lever/Ashby/Workable/SmartRecruiters company boards,
plus aggregators) — deliberately no HTML scraping here. Filtering (keywords, location/country aliasing,
exclude list, career level, max age) is re-applied to already-stored items on every save/refresh, not
just to new fetches, so loosening a filter can resurface previously hidden postings without re-fetching.
Scoring is two-stage: a free deterministic ATS keyword screen (`ats.ts`) against the base resume(s)
gates which postings are worth spending an LLM call on for the "Feed triage" task.

### Auth & secrets

Auth is an optional single-password gate (`auth.ts`, cookie session, backoff on failed attempts), off by
default. Saved LLM API keys and the auth password are encrypted at rest (`crypto.ts`) using a key
generated on first run at `data/secret.key` — losing that file only means re-entering keys, not losing
tracker data.
