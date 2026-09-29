"use client";

import { useCallback, useEffect } from "react";
import { useIsClient, useLocalStorage } from "@/lib/use-client";

export type ThemeMode = "light" | "dark" | "system";
const KEY = "shd-theme";
const MODES: readonly ThemeMode[] = ["light", "dark", "system"];

function apply(mode: ThemeMode) {
  const dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.themeMode = mode;
}

/**
 * Light / dark / follow the OS. The choice lives in localStorage (the inline theme script paints it
 * before React loads); every tab follows a change made in another one.
 */
export function useTheme() {
  const [stored, setStored] = useLocalStorage(KEY, "system");
  const mode: ThemeMode = MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : "system";
  const mounted = useIsClient();

  // paint the page whenever the mode changes (here or in another tab)
  useEffect(() => {
    apply(mode);
  }, [mode]);

  // "system": follow the OS switching between light and dark
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const set = useCallback((m: ThemeMode) => setStored(m), [setStored]);

  return { mode, setMode: set, mounted };
}
