# Contributing

Thanks for looking at Job Tracker. It's a small, personal-use tool — issues and PRs are welcome,
but keep in mind the maintainer optimizes for "does this help me apply to jobs," not breadth of
features or configurability for its own sake.

## Before you start

For anything more than a small fix, open an issue first to talk through the approach — it's a lot
cheaper than a PR that gets rejected because the change doesn't fit the project's scope. Bug fixes
and doc corrections can just be a PR.

## Development setup

```bash
npm install
cp .env.example .env        # add an API key, or point OLLAMA_HOST at a local Ollama for a free path
npm run dev                  # http://localhost:4321, restarts on file changes
```

Requires Node 22.6+. There's no build step (native TypeScript type-stripping) and no test suite —
verify a change by actually running the app and exercising the affected flow in the browser, plus:

```bash
npx tsc --noEmit    # type-check — this is the only automated check the project has
```

If you're touching PDF generation, install LaTeX (`brew install --cask basictex` on macOS) so you
can confirm the compiled output, not just the browser-print fallback.

## Code conventions

This codebase favors dense, comment-light TypeScript with comments only where the *why* isn't
obvious from the code. Some patterns worth matching rather than reinventing:

- **Routes** live in `src/server.ts` as `if (m("METHOD", /regex/)) { ... }` blocks, in a single
  hand-rolled router — no framework, no new routing abstraction.
- **Anything that calls an LLM** goes through the job queue (`src/queue.ts`): register a handler
  with `registerJob` in `src/jobs.ts`, add a task to `TASKS` in `src/settings.ts` if it should be
  independently routable to a provider/model, and enqueue it from a route via `queueJob()`
  (`src/preflight.ts`) so it gets the same preflight/guard/retry handling as everything else.
- **Every model result** should be plausible enough to trust unattended — lean on `src/guard.ts`
  rather than adding ad hoc validation in a handler.
- Full architecture notes (request flow, job queue, provider layer, document pipeline, storage
  layout) are in `CLAUDE.md` — read it before making a structural change.

## What's likely to be a good contribution

- Bug fixes, especially in the ATS scraping/feed-source parsing, LaTeX rendering, or the autofill
  bookmarklet's field-matching, which are the fiddliest and most site-specific parts of the app.
- New job-feed sources or company-board resolvers (`src/feed.ts`) that use official JSON endpoints,
  not HTML scraping — that constraint is deliberate (see "Job feed" in `README.md`). A source that
  can't meet it belongs in an extension (`extensions/README.md`), which is exactly what they're for;
  improvements to the extension API itself are welcome in-tree.
- Additional LLM providers behind the existing `Provider`/`TASKS` abstraction in `src/settings.ts`
  and `src/llm.ts`.

## What's likely to be turned down

- Features that require a server component, telemetry, or any data leaving your machine by
  default — this is meant to stay a local-first, single-user tool.
- Scraping HTML from sites that block it, or anything that tries to solve/bypass a CAPTCHA or
  bot-verification check — the app deliberately hands those to the user instead (see "When a site
  asks for a human" in `README.md`).
- Large refactors or new abstractions without a concrete bug or missing feature driving them.

## Pull requests

- Keep PRs focused — one change, one PR.
- Run `npx tsc --noEmit` and actually exercise the change in the running app before opening the PR;
  say in the PR description what you tested and how.
- Describe the *why*, not just the *what* — the commit message and PR description are where that
  belongs, not code comments.
