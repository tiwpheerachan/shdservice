"use client";

import * as React from "react";
import useSWR from "swr";

export type Me = { name: string; email: string; avatar?: string };
type MeResponse = { user: Me | null; exp?: number };

export const ME_KEY = "/api/sso/me";

/** quiet fetch: a 401 / network error is "not known yet", never a redirect (the session timer decides that) */
async function fetchMe(url: string): Promise<MeResponse | null> {
  const r = await fetch(url, { cache: "no-store" });
  return r.ok ? ((await r.json()) as MeResponse) : null;
}

/**
 * The signed-in user + the session cookie's expiry, from ONE request shared by every component
 * that asks (topbar avatar, session countdown, …). After renewing the session call `refresh()`
 * to read the new expiry.
 */
export function useMe() {
  const { data, mutate } = useSWR(ME_KEY, fetchMe, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  });
  const refresh = React.useCallback(() => mutate(), [mutate]); // stable — safe in effect deps
  return {
    user: data?.user ?? null,
    exp: typeof data?.exp === "number" ? data.exp : null,
    refresh,
  };
}
