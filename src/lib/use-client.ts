"use client";

import * as React from "react";

/*
 * Values only the browser has (localStorage, the clock), read with useSyncExternalStore: the server
 * and the hydration pass render the fallback, the browser's value follows right after — no
 * hydration mismatch, and no useEffect + setState second pass.
 */

const never = () => () => {};

/** false on the server and during hydration, true after */
export function useIsClient(): boolean {
  return React.useSyncExternalStore(never, () => true, () => false);
}

/** when this component mounted in the browser (null on the server / during hydration) */
export function useMountTime(): Date | null {
  const isClient = useIsClient();
  const [at] = React.useState(() => new Date());
  return isClient ? at : null;
}

const SAME_TAB = "shd-local-storage"; // the "storage" event only fires in OTHER tabs

function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback; // storage blocked (private mode / policy)
  }
}

/**
 * A string kept in localStorage — every component using the same key, in every open tab, sees a
 * change at once.
 */
export function useLocalStorage(key: string, fallback: string): [string, (value: string) => void] {
  const subscribe = React.useCallback(
    (changed: () => void) => {
      const onStorage = (e: StorageEvent) => {
        if (e.key === key || e.key === null) changed();
      };
      const onSameTab = (e: Event) => {
        if ((e as CustomEvent<string>).detail === key) changed();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(SAME_TAB, onSameTab);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(SAME_TAB, onSameTab);
      };
    },
    [key]
  );
  const value = React.useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback
  );
  const set = React.useCallback(
    (v: string) => {
      try {
        localStorage.setItem(key, v);
      } catch {
        /* storage blocked — the value just does not persist */
      }
      window.dispatchEvent(new CustomEvent(SAME_TAB, { detail: key }));
    },
    [key]
  );
  return [value, set];
}
