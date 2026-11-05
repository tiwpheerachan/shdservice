'use client';

import * as React from 'react';
import useSWR from 'swr';

export type Me = { name: string; email: string; avatar?: string };
type MeResponse = {
  user: Me | null;
  exp?: number;
  approved?: boolean;
  unauthorized?: boolean;
  /** 401 because this browser signed out (ออกจากระบบ in another tab), not an expiry */
  signedOut?: boolean;
};

export const ME_KEY = '/api/sso/me';

/** the page's first read: AccessGuard's page-change refresh() on mount joins it instead of making a second
 *  /api/sso/me request. Only that one — a later refresh (e.g. after renewing the session) always reads anew */
let firstRead: Promise<MeResponse> | null = null;
let firstDone = false;
function fetchMe(url: string): Promise<MeResponse> {
  if (firstDone) return readMe(url);
  firstRead ??= readMe(url).finally(() => (firstDone = true));
  return firstRead;
}

/**
 * quiet fetch — never redirects by itself: a 401 comes back as `unauthorized` (AccessGuard decides
 * what to do); a network error throws, so swr keeps the last answer
 */
async function readMe(url: string): Promise<MeResponse> {
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 401) {
    const b = (await r.json().catch(() => null)) as { signedOut?: boolean } | null;
    return { user: null, unauthorized: true, signedOut: !!b?.signedOut };
  }
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
    exp: typeof data?.exp === 'number' ? data.exp : null,
    /** undefined until known */
    approved: data?.approved,
    unauthorized: !!data?.unauthorized,
    signedOut: !!data?.signedOut,
    refresh,
  };
}
