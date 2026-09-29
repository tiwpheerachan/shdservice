"use client";

import * as React from "react";
import useSWR from "swr";

export type Me = { name: string; email: string; avatar?: string };
type MeResponse = { user: Me | null; exp?: number; approved?: boolean; unauthorized?: boolean };

export const ME_KEY = "/api/sso/me";

/**
 * quiet fetch — never redirects by itself: a 401 comes back as `unauthorized` (AccessGuard decides
 * what to do); a network error throws, so swr keeps the last answer
 */
async function fetchMe(url: string): Promise<MeResponse> {
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 401) return { user: null, unauthorized: true };
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as MeResponse;
}

/**
 * The signed-in user, their approval and the session cookie's expiry, from ONE request shared by
 * every component that asks (topbar avatar, session countdown, AccessGuard). Reading it never
 * extends the session — only real activity does (SessionTimer → /api/sso/refresh).
 *   poll    → re-read every N ms while the tab is visible (AccessGuard — one poller for all)
 *   refresh → read again now (after renewing the session, after a page change)
 */
export function useMe(opts: { poll?: number } = {}) {
  const { data, mutate } = useSWR(ME_KEY, fetchMe, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
    ...(opts.poll ? { refreshInterval: opts.poll } : {}),
  });
  const refresh = React.useCallback(() => mutate(), [mutate]); // stable — safe in effect deps
  return {
    user: data?.user ?? null,
    exp: typeof data?.exp === "number" ? data.exp : null,
    /** undefined until known */
    approved: data?.approved,
    unauthorized: !!data?.unauthorized,
    refresh,
  };
}
