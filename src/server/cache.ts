import "server-only";

/**
 * Tiny in-process TTL cache for small, read-mostly lookups (master lists,
 * staff, provinces, …). Stores the PROMISE, so 16 parallel requests for a cold
 * key share one query instead of racing 16. Single Render instance → no need
 * for anything shared; write paths call `invalidate()` so an edit is visible
 * on the next request, and the TTL bounds staleness from direct SQL edits.
 * Same pattern as the grants cache in src/server/auth.ts.
 */
type Entry = { at: number; value: Promise<unknown> };
const store = new Map<string, Entry>();

export const TTL_MASTER = 60_000;
export const TTL_STATIC = 60 * 60_000; // provinces & co. — never edited through the app

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load().catch((e: unknown) => {
    store.delete(key); // never cache a failure
    throw e;
  });
  store.set(key, { at: Date.now(), value });
  return value;
}

/** Drop every key starting with `prefix` ("" = everything). */
export function invalidate(prefix = "") {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
