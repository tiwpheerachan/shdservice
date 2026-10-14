/** The test database — never anything but a local throwaway one. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:test@127.0.0.1:55442/oneservice_test";

export function assertLocal(url: string): void {
  if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) {
    console.error(`REFUSED: tests only run against a local database (got ${url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@")})`);
    process.exit(1);
  }
}
