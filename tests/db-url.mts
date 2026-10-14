/** The test database — never anything but a local throwaway one. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:test@127.0.0.1:55442/oneservice_test";

/**
 * Parsed, not pattern-matched: "…@localhost/x?host=db.<ref>.supabase.co" or a password holding
 * "@127.0.0.1:1/" would pass a regex. Only a *_test database — the seed TRUNCATEs tables, so
 * the dev DB (oneservice_dev) is refused too.
 */
export function assertLocal(url: string): void {
  let ok = false;
  try {
    const u = new URL(url);
    ok = ["127.0.0.1", "localhost"].includes(u.hostname) && !u.searchParams.has("host") && /^\/[a-z0-9_]+_test$/.test(u.pathname);
  } catch {
    ok = false;
  }
  if (!ok) {
    console.error(`REFUSED: tests only run against a local database (got ${url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@")})`);
    process.exit(1);
  }
}
