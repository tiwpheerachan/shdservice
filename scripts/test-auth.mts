/**
 * npm run test:auth — sign-in redirect safety (src/lib/sso.ts). Pure: no DB, no network.
 */
import assert from "node:assert/strict";
import { safeNext, DEFAULT_AFTER_LOGIN } from "../src/lib/sso.ts";

const D = DEFAULT_AFTER_LOGIN;
const cases: [string | null | undefined, string][] = [
  [null, D],
  ["", D],
  ["https://evil.example", D],
  ["//evil.example", D],
  ["/\\evil.example", D],
  ["/\t/evil.example", D], // tab is stripped by the URL parser → //evil.example
  [decodeURIComponent("/%09/evil.example"), D],
  [decodeURIComponent("/%09%5Cevil.example"), D],
  ["/\n/evil.example", D],
  ["javascript:alert(1)", D],
  ["/jobs/dashboard", "/jobs/dashboard"],
  ["/jobs?x=1#y", "/jobs?x=1#y"],
  ["/customers/123/edit", "/customers/123/edit"],
];

let failed = 0;
for (const [input, want] of cases) {
  try {
    assert.equal(safeNext(input), want);
    const target = new URL(safeNext(input), "https://app.example");
    assert.equal(target.origin, "https://app.example");
    console.log(`  ✓ ${JSON.stringify(input)}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${JSON.stringify(input)}: ${(e as Error).message}`);
  }
}
console.log(`\n${cases.length - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
