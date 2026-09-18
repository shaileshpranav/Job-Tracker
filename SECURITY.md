# Security

Job Tracker is a local, single-user app: no telemetry, no server component beyond the one you run
on your own machine, and no accounts. Its threat model is mainly "someone else on my network" and
"I lose my laptop," not multi-tenant abuse — see **Security** in `README.md` for the full
walkthrough of what's protected and how.

Worth knowing if you're evaluating whether to run this:

- The server listens on `0.0.0.0` (all interfaces) by default, specifically so you can reach it
  from your phone on the same Wi-Fi. On shared or untrusted networks, either set `AUTH_PASSWORD` /
  add a password from Settings → Security, or set `HOST=127.0.0.1` in `.env` to keep it
  local-only.
- Saved LLM API keys and the auth password are encrypted at rest (`src/crypto.ts`, AES-256-GCM /
  scrypt) using a key generated on first run at `data/secret.key`. That file and `data/tracker.db`
  are both gitignored and never leave your machine on their own — back them up together if you
  care about not re-entering keys.
- The autofill bookmarklet authenticates cross-origin with a signed token embedded in the
  bookmarklet's own code (`src/auth.ts`) rather than your session cookie. Changing your password
  revokes every previously-dragged copy.
- The app never attempts to solve or bypass a CAPTCHA, Cloudflare check, or login wall — see "When
  a site asks for a human" in `README.md`.

## Reporting a vulnerability

Please **don't** open a public GitHub issue for a security bug. Instead, email the maintainer at
the address on the [GitHub profile](https://github.com/shaileshpranav), or use GitHub's
[private vulnerability reporting](https://github.com/shaileshpranav/Job-Tracker/security/advisories/new)
if it's enabled on the repo. Include:

- What you found and roughly how severe you think it is.
- Steps to reproduce, or a proof of concept.
- Which version/commit you tested against.

This is a side project maintained by one person — there's no formal SLA, but security reports get
priority over feature work and I'll credit you in the fix unless you'd rather stay anonymous.

## Scope

In scope: anything in this repository. Out of scope: the security of third-party services it talks
to (Anthropic, OpenRouter, Ollama, job boards/aggregators) — report those to their own maintainers.
