"use client";

import * as React from "react";
import { Timer, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/use-me";
import { toLogin } from "@/lib/navigation";

const WARN_SECONDS = 5 * 60;
const AUTO_REFRESH_EVERY_MS = 5 * 60 * 1000; // activity-based renewal, at most every 5 min (TTL is 30 min)

/**
 * Idle-timeout countdown (30 min): reads the cookie's expiry from /api/sso/me (useMe — shared with
 * the topbar and AccessGuard, re-read every minute, so it shows the server's real expiry). The ONLY
 * thing that extends the session is this component: /api/sso/refresh on the button, and
 * automatically on user activity at most every 5 minutes. No activity for 30 min → the session ends
 * on the server and this sends the user to /login.
 */
export function SessionTimer() {
  const { exp, refresh: reloadMe } = useMe();
  const [now, setNow] = React.useState(() => Date.now());
  const lastRefresh = React.useRef(0);

  const refresh = React.useCallback(async () => {
    lastRefresh.current = Date.now();
    try {
      const r = await fetch("/api/sso/refresh", { cache: "no-store" });
      if (r.status === 401) {
        toLogin();
        return;
      }
      await reloadMe();
    } catch {
      /* ignore */
    }
  }, [reloadMe]);

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // renew on activity, throttled
  React.useEffect(() => {
    const onActivity = () => {
      if (Date.now() - lastRefresh.current > AUTO_REFRESH_EVERY_MS) void refresh();
    };
    // reading/scrolling counts as activity too — not just clicks and typing
    const events = ["click", "keydown", "scroll", "pointerdown", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, [refresh]);

  const left = exp ? Math.max(0, Math.floor((exp - now) / 1000)) : null;

  // expired → back through SSO
  React.useEffect(() => {
    if (left === 0) toLogin();
  }, [left]);

  const p = (n: number) => String(n).padStart(2, "0");
  const label =
    left === null
      ? "--:--"
      : left >= 3600
        ? `${p(Math.floor(left / 3600))}:${p(Math.floor((left % 3600) / 60))}:${p(left % 60)}`
        : `${p(Math.floor(left / 60))}:${p(left % 60)}`;
  const warn = left !== null && left <= WARN_SECONDS;

  return (
    <div
      className={cn(
        "hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs sm:flex",
        warn
          ? "border-warning/30 bg-warning-soft text-warning"
          : "border-border bg-muted/60 text-muted-foreground"
      )}
      title="เซสชันหมดอายุเมื่อไม่มีการใช้งาน 30 นาที — ใช้งานอยู่จะต่ออายุให้อัตโนมัติ หรือกดปุ่มเพื่อต่ออายุ"
    >
      <Timer className="h-3.5 w-3.5" />
      <span className="num font-medium tracking-tight">{label}</span>
      <button
        onClick={() => void refresh()}
        className="ml-0.5 rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
        aria-label="ต่ออายุเซสชัน"
      >
        <RotateCw className="h-3 w-3" />
      </button>
    </div>
  );
}
