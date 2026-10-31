import 'server-only';
import { LRUCache } from 'lru-cache';

/**
 * In-process cache for small read-mostly lookups. Single Render instance, so nothing shared; writes call invalidate(),
 * the TTL bounds staleness from direct SQL edits. Single-flight per cold key, stale-while-revalidate up to 2× TTL,
 * at most 500 keys (some come from user input), a failed load is not cached.
 */
type Box = { v: unknown; at: number };
type Loader = () => Promise<unknown>;

// ONE store per process on globalThis: route handlers and pages load in separate module runtimes, so a module-level
// store would exist twice and an /api write would leave the page's copy stale.
const g = globalThis as typeof globalThis & { __shdCache?: LRUCache<string, Box, Loader> };
const store = (g.__shdCache ??= new LRUCache<string, Box, Loader>({
  max: 500,
  ttl: 60_000,
  allowStale: true,
  fetchMethod: async (_key, _stale, { context }) => ({ v: await context(), at: Date.now() }),
}));

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
export function invalidate(prefix = '') {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
