<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Production-readiness work

Active plan: [docs/production-readiness.md](docs/production-readiness.md). Pick the next unchecked item in its order, keep `tsc --noEmit` and `eslint .` clean, tick the checkbox when done.
Never run `setupdata/load_supabase.sh`, `npm run db:migrate:reset` or `npm run test:track` against the production database.
