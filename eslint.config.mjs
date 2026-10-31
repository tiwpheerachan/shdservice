import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

/**
 * `npm run lint` — Next.js recommended rules (core-web-vitals + TypeScript) plus project rules.
 */
const R2 = "it re-checks the signed-in user's role inside the transaction (R2).";
const NO_RAW_TX = { object: 'db', property: 'transaction', message: `Use writeTx() from @/db/client: ${R2}` };
const NO_RAW_WRITE = ['insert', 'update', 'delete'].map((property) => ({
  object: 'db',
  property,
  message: `Write inside writeTx() from @/db/client (tx.${property}): ${R2}`,
}));

export default defineConfig([
  globalIgnores([
    '.next/**',
    '.next-*/**',
    '.apidoc/**',
    'node_modules/**',
    'drizzle/**',
    'public/**',
    'next-env.d.ts',
  ]),
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React escapes text safely; this rule only flags quotes in Thai UI copy (80 of them)
      'react/no-unescaped-entities': 'off',
      // Business dates are Thai (src/lib/dates.ts). toISOString() is UTC — sliced into a date it is
      // "yesterday" between 00:00 and 06:59 Thai time (dogfood ISSUE-001, 2026-09-28).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^(slice|substring|substr|split)$/][callee.object.type='CallExpression'][callee.object.callee.property.name='toISOString']",
          message:
            "Don't cut a date out of toISOString() (UTC). Use today() / isoDate() / isoDateTime() / addDays() from @/lib/dates (Thai calendar).",
        },
      ],
    },
  },
  // R2: a request's write transaction re-checks the actor's current role — writeTx (src/db/client.ts), not
  // db.transaction; a service writes only inside one (a bare db.insert / update / delete would skip the check)
  {
    files: ['src/server/services/**', 'src/server/*.ts', 'src/app/**'],
    rules: { 'no-restricted-properties': ['error', NO_RAW_TX] },
  },
  {
    files: ['src/server/services/**'],
    rules: { 'no-restricted-properties': ['error', NO_RAW_TX, ...NO_RAW_WRITE] },
  },
  // no staff write to re-check: the public /track (tracking.ts — the customer, no user) and the user's own tour
  // progress (tour.ts — app_user_tour, not business data)
  {
    files: ['src/server/services/{tracking,tour}.ts'],
    rules: { 'no-restricted-properties': ['error', NO_RAW_TX] },
  },
  // sign-in / sign-out run before / after any signed-in user exists (no request user: writeTx would be db.transaction)
  { files: ['src/app/api/sso/**'], rules: { 'no-restricted-properties': 'off' } },
  // the one place allowed to do date arithmetic
  { files: ['src/lib/dates.ts'], rules: { 'no-restricted-syntax': 'off' } },
  // plain <img> on purpose: nothing uses next/image (/_next/image is switched off, next.config.mjs) —
  // print/PDF pages must render the image as-is, /api/files answers with a short-lived signed URL
  // (logos, product photos, slips), avatars come from Lark, and the brand logos are static files
  {
    files: [
      'src/components/print/**',
      'src/components/shared/{logo,people-picker,product-detail-modal,attachments}.tsx',
      'src/components/layout/topbar.tsx',
      'src/app/track/**',
      'src/app/pending/page.tsx',
      'src/app/(app)/admin/{shipping-profiles,document-profiles}/page.tsx',
      'src/app/(app)/admin/users/{user-columns,user-dialog}.tsx',
    ],
    rules: { '@next/next/no-img-element': 'off' },
  },
  // last: formatting belongs to Prettier (npm run format) — turn off ESLint's style rules
  prettier,
]);
