<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Production-readiness work

Active plan: [docs/production-readiness.md](docs/production-readiness.md). Pick the next unchecked item in its order, keep `tsc --noEmit` and `eslint .` clean, tick the checkbox when done.
Env files: production's values live on **Render** (Environment). On this machine they are only in `.env.prod.local` (**PRODUCTION**, Supabase `bnntps…`) — read by the owner's production commands alone: `db:prod:migrate` (asks first), `db:seed:export` (default source), `setupdata/cutover.sh`, `scripts/legacy-files.mts`. Dev uses `.env.development.local` only (template: `.env.development.example`, every variable listed). There must be **no `.env`** in this folder: Next.js loads a file of that name into `next dev` / `build` / `start`, so a variable missing from the dev file would silently take production's value. `scripts/migrate.ts` and `drizzle.config.ts` load no env file — every caller names its database.
Develop against the Docker dev DB (`npm run db:dev:up`, used by `npm run dev`); tests use the Docker test DB (`npm run db:test:up && npm run db:test:prepare`). Never read `.env.prod.local` or run anything that loads it, and never `setupdata/load_supabase.sh` / `db:migrate:reset` on production. Migrations by target (ADR 0009): `db:dev:migrate` (local), `db:prod:migrate` (production — the owner runs it, it asks first), `db:migrate:deploy` (Render only).
Agents running a server for QA / perf / a11y: use `npm run e2e` (its setup reads no env file), or copy the repo **without any `.env*` file** to the scratchpad and run there with explicit env (`DATABASE_URL` = the dev or test DB) and the fake SSO from `tests/e2e/support/fake-sso.ts` — `next dev/build/start` in this folder load `.env.development.local` (dev) and `.env.local`, which must never point at production.

# Comments

Write a comment only for what the code cannot say: **why** (a non-obvious choice, a constraint, a workaround, an invariant, a security or money rule) or a gotcha the next reader would trip on. One line when one line is enough.
Do not write: what the code plainly does, change history ("was…", "before 0006…", "now…"), dates, who decided what (that belongs in the commit, an ADR or docs/), restating a type or a name, section banners, or commented-out code. A test says its intent in its name; comment only setup that isn't obvious.
Keep: `'use client'` / `'server-only'` directives, eslint/ts directives with their reason, `ponytail:` notes (a deliberate shortcut with its ceiling), and doc comments on exported functions where the behaviour isn't evident from the name and types.

# Splitting work across agents

Split a task by area, one agent per area, so each gets a focused brief and none of them edit the same files. Run agents in parallel only when their file sets don't overlap (e.g. auth/proxy vs. services/migrations); otherwise run them one after another. The main session writes the briefs, integrates the results, re-runs the checks itself, and ticks the plan — never trust a report without `tsc`, `eslint .`, `npm test`, `npm run test:db` passing.

| Work | Use |
|---|---|
| Find code, trace a flow, impact of a change | `graphify` (knowledge graph — query it first when `graphify-out/` exists), then an Explore agent |
| Spec / break down a large task | `agent-skills:spec`, `agent-skills:plan` |
| Implement / fix | `ponytail` (smallest diff, fix the root cause where every caller passes, reuse what exists) + `agent-skills:build` / incremental slices |
| Tests | `agent-skills:test` (bug → failing test first), `agent-skills:test-engineer` for coverage |
| Review before merge | `agent-skills:code-reviewer` (`/review`), `ponytail:ponytail-review` (over-engineering), `ponytail:ponytail-audit` (whole repo) |
| Security (auth, uploads, `/track`, anything public) | `security-audit` skill (Cloudflare) + `agent-skills:security-auditor` |
| UI / QA in a real browser | `agent-browser` + `dogfood` (exploratory QA with repro screenshots), [Tencent BrowserSkill](https://github.com/Tencent/BrowserSkill) for the logged-in Chromium — against `npm run dev` + dev DB, never production data |
| Web performance | `agent-skills:web-performance-auditor` |

Every agent brief states: the files it owns (and the ones it must not touch), that `.env` is production and only local DBs may be used, that it must not commit, and that it reports file:line, what it skipped and why, and the check results. Areas already in progress are listed in [docs/production-readiness.md](docs/production-readiness.md).

# Adding an API endpoint

The API is contract-first ([adr/0007](adr/0007-contract-first-api.md)): `src/server/contract` is what `/api-docs`, `/api/openapi.json` and the response check are built from.

1. Declare it with `defineOperation` in `src/server/contract/<family>.ts`: params, query, headers, body (or `form` for multipart) and **every** response, errors included (`SIGNED_IN`, `JSON_BODY`, `CONFLICT`, `IDEMPOTENCY`, … from `common.ts`; shared records in `shapes.ts`). A body checked with a form schema from `src/lib/validation` IS that schema; a body a service checks against the stored record is the rule set's static part (`customerFields`, or `.shape` of the factory with the prev-dependent fields at their bare type) plus the types of fields the rules do not declare. A choice the route ignores when wrong is `choice()` / `flag`, never a 400. Refusals: by default the form rules' 400 + `details.fields`; `invalid: { query: 400 }` etc. answers with the schema's own message instead (`'id required'`).
2. Write the route with `handle()` (a route that answers without it wraps itself in `checked()`) and read **every** input with `parseParams` / `parseQuery` / `parseHeaders` / `parseBody` / `parseForm` (`src/server/auth.ts`) and the operation — never `req.json()`, `searchParams`, `ctx.params` or `headers.get` (`npm test` → `scripts/test-routes-input.mts`). Call them where the check belongs: their place decides whether a caller sees 401 / 403 / 400 / 404 first. Under `next dev` an answer that does not match its declaration logs `API contract drift`.
3. Call it in `scripts/test-api.mts` — `npm run test:db` runs strict (`API_CONTRACT_STRICT=1`) and fails on drift or on an operation nobody called. A new shared response shape gets a line in `scripts/test-response-types.ts` (its `z.input` = the service type; `tsc` fails on drift).
4. `npm run test:openapi -- --update` and review the snapshot diff (`tests/fixtures/openapi.snapshot.json`); `npm run docs:api` rebuilds `/api-docs`.
