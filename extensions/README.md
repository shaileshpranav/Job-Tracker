# Extensions

Connectors for job boards the bundled sources don't cover.

The sources that ship with Job Tracker are deliberately limited to **official, public JSON
endpoints** — no HTML scraping, nothing behind a `robots.txt` opt-out. That rule keeps the core
honest, but it also means plenty of boards can't be supported in-tree: internal APIs, sites that
only render HTML, your employer's private board.

Extensions are the escape hatch. They're **your** code, and the rules are yours to pick.

> **They run in the server process** with the same access the app has — your tracked applications,
> your `data/tracker.db`, your saved API keys. Only install extensions you've read and trust.
> Treat installing one exactly like editing `src/` yourself, because it's equivalent.

## Installing

Drop a `.ts` (or `.js`) file into this directory and restart the server. Loaded extensions and any
that failed to load are listed under **Settings → Extensions**. Files starting with `_` or `.` are
ignored, as is everything in subdirectories — so `examples/` below is inert until you copy one out.

Set `EXTENSIONS_DIR` in `.env` to keep them somewhere else.

## Pausing, removing, pulling on demand

From **Settings → Extensions** each installed extension gets:
- **Pause / Resume** — stops it being used for refreshes, board discovery and capture without
  touching its file or its saved board tokens/feed settings. Reversible, no restart needed.
- **Remove** — deletes the file from this directory and drops it from the registry immediately
  (no restart needed). This is not reversible; reinstall by dropping the file back in.
- **Pull now** (boards and aggregators) — refreshes the feed using only that extension's
  source(s), ignoring everything else configured. Doesn't count as a full feed refresh (it
  doesn't reset the auto-refresh timer or the "last refreshed" time shown elsewhere).

## The contract

```ts
export default {
  id: "acme",                  // lowercase [a-z0-9-], unique. Board extensions use it as
                               // the provider prefix: a board id is then "acme:<token>"
  label: "Acme Job Board",
  kind: "board",               // "board"      — one instance per company, configured as "acme:sometoken"
                               // "aggregator" — one global source, toggled on in the feed settings
                               // omit entirely for a capture-only extension

  // Board extensions only, optional: turn a careers URL into a token so "Find board" resolves it.
  match(url) {
    return /acme\.example\/careers\/([\w-]+)/.exec(url)?.[1] ?? null;
  },

  // Return the postings. `token` is the board token, or "" for an aggregator.
  async fetch(token, ctx) {
    const data = await ctx.fetchJson(`https://acme.example/api/jobs?org=${token}`);
    return data.jobs.map((j) => ({
      id: j.id,                       // optional, defaults to the url
      title: j.title,                 // required
      company: j.company,             // optional, defaults to the extension's label
      location: j.location,           // optional
      remote: j.is_remote,            // optional
      salary: j.salary,               // optional
      url: j.apply_url,               // required, must be http(s)
      description: j.description_text,// optional but strongly recommended — fit scoring and the
                                      // ATS keyword screen both work off it
      posted_at: j.published,         // optional; Date, ISO string or unix seconds
    }));
  },

  // Optional, independent of `kind`: take over single-posting capture for URLs you recognise.
  // Return the page text for the extractor, or null to fall through to the normal capture path.
  capture: {
    matches: (url) => url.includes("acme.example/jobs/"),
    async fetch(url, ctx) {
      const html = await ctx.fetchText(url);
      return ctx.jobPostingFromJsonLd(html) || ctx.htmlToText(html);
    },
  },
};
```

### `ctx`

| | |
|---|---|
| `ctx.fetchJson(url, init?)` | GET + parse JSON, throws on non-2xx |
| `ctx.fetchText(url, init?)` | GET + return body text |
| `ctx.postJson(url, body, init?)` | POST JSON, parse the JSON reply — internal APIs usually want this |
| `ctx.htmlToText(html)` | The same crude HTML→text the core capture path uses |
| `ctx.jobPostingFromJsonLd(html)` | Pull a schema.org `JobPosting` out of a page, or `""` |
| `ctx.progress(msg)` | Note for the log |
| `ctx.keywords`, `ctx.locations` | The user's feed settings, for sources that search rather than list |

Every request helper sends a 25s timeout and a `JobTracker/1.0` user-agent. An extension's whole
`fetch` is capped at 120s and at 2000 postings.

### What the app does with what you return

Postings without an `http(s)` `url` or a `title` are dropped. The rest go through exactly the same
pipeline as a built-in source: keyword/location/level/age filters, deduplication by URL and by
normalised company+title, the free ATS keyword screen, then model fit scoring for whatever survives.
A source that returns no `description` still works — it just gets scored on its title alone.

A `fetch` that throws is reported against that one source in the refresh summary; the rest of the
refresh carries on. A file that fails to load is reported in Settings → Extensions and never takes
the server down with it.

## Please don't

- Automate *solving* a CAPTCHA, a login wall or a bot check — no solving services, no fingerprint
  spoofing or stealth tooling built to trick the check into thinking it isn't automation. The app's
  default answer for these is deliberate and documented: park the task and ask you to clear it
  yourself in your own browser — see "When a site asks for a human" in the main README.

  Driving a **real, persistent browser profile you log into by hand** (Playwright or similar) is a
  different thing and is fine: you're still the one clearing the check and, if there is one, signing
  in — the extension just reuses the session you established instead of asking you to hand over page
  text every single time, which doesn't scale to a search source that needs many requests per
  refresh. A `jobstreet-sg.ts` extension using this pattern (not bundled — it's one person's, kept
  local like any installed extension) has a matching `_jobstreet-sg-login.ts` next to it: a small
  script, prefixed with `_` so the loader ignores it as an extension of its own, that opens a real
  window for you to clear Cloudflare (and sign in, if you want) once — `node
  --env-file-if-exists=.env extensions/_your-login-script.ts`. The extension reuses that saved
  profile headlessly afterwards, and should report a clear "run the login script again" error
  instead of quietly hanging if the session goes stale. This pulls in `playwright` (an optional
  dependency — `npm install` still works without it) and a real browser binary, so reach for it
  only when a source genuinely can't be read with plain requests; it's much heavier than
  `ctx.fetchJson`/`fetchText`.

- Ignore a site's `robots.txt`. Check it before you write the connector; if the endpoint you want is
  disallowed, that's the site telling you no.
- Hammer anything. One refresh should be a handful of requests, not hundreds.
