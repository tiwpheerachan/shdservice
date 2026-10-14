<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Production-readiness work

Active plan: [docs/production-readiness.md](docs/production-readiness.md). Pick the next unchecked item in its order, keep `tsc --noEmit` and `eslint .` clean, tick the checkbox when done.
`.env` is **PRODUCTION** (Supabase `bnntps…`). Develop against the Docker dev DB (`npm run db:dev:up`, used by `npm run dev` via `.env.development.local`); tests use the Docker test DB (`npm run db:test:up && npm run db:test:prepare`). Never run anything that reads `.env` against the database, and never `setupdata/load_supabase.sh` / `db:migrate:reset` on production.

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
