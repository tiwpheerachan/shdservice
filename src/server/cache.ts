import "server-only";
import { LRUCache } from "lru-cache";

/**
 * In-process cache for small, read-mostly lookups (master lists, staff, statuses, dashboard,
 * alerts), on lru-cache. Single Render instance → no need for anything shared; write paths call
 * `invalidate()` so an edit is visible on the next request, and the TTL bounds staleness from
 * direct SQL edits.
 *
 *  - single-flight: parallel requests for a cold key share ONE load (the dashboard's four panels,
 *    16 dropdowns on a form) instead of racing N identical queries
 *  - stale-while-revalidate: shortly after expiry the last value is returned at once while one
 *    refresh runs in the background — nobody waits for the reload. Older than 2× TTL it is not
 *    served; the caller waits for fresh data
 *  - bounded: at most 500 keys (some keys come from user input, e.g. dashboard date ranges),
 *    least-recently-used first out
 *  - a failed load rejects and is not cached
 */
type Box = { v: unknown; at: number };
type Loader = () => Promise<unknown>;

const store = new LRUCache<string, Box, Loader>({
  max: 500,
  ttl: 60_000, // default; every call passes its own
  allowStale: true,
  fetchMethod: async (_key, _stale, { context }) => ({ v: await context(), at: Date.now() }),
});

export const TTL_MASTER = 60_000;
export const TTL_STATIC = 60 * 60_000; // provinces & co. — never edited through the app

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  // stale-while-revalidate only within one TTL past expiry
  const old = store.peek(key, { allowStale: true });
  if (old && Date.now() - old.at > 2 * ttlMs) store.delete(key);

  const box = await store.fetch(key, { ttl: ttlMs, context: load });
  if (box) return box.v as T;
  // invalidate() ran while this load was in flight (the data just changed) → load it again
  const again = await store.fetch(key, { ttl: ttlMs, context: load });
  return (again ?? { v: await load() }).v as T;
}

/** Drop every key starting with `prefix` ("" = everything). */
export function invalidate(prefix = "") {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
