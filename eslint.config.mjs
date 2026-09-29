import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * `npm run lint` — Next.js recommended rules (core-web-vitals + TypeScript) plus project rules.
 */
export default defineConfig([
  globalIgnores([".next/**", ".next-*/**", "node_modules/**", "drizzle/**", "public/**", "next-env.d.ts"]),
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React escapes text safely; this rule only flags quotes in Thai UI copy (80 of them)
      "react/no-unescaped-entities": "off",
      // Business dates are Thai (src/lib/dates.ts). toISOString() is UTC — sliced into a date it is
      // "yesterday" between 00:00 and 06:59 Thai time (dogfood ISSUE-001, 2026-09-28).
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(slice|substring|substr|split)$/][callee.object.type='CallExpression'][callee.object.callee.property.name='toISOString']",
          message:
            "Don't cut a date out of toISOString() (UTC). Use today() / isoDate() / isoDateTime() / addDays() from @/lib/dates (Thai calendar).",
        },
      ],
    },
  },
  // the one place allowed to do date arithmetic
  { files: ["src/lib/dates.ts"], rules: { "no-restricted-syntax": "off" } },
]);
