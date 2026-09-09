"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/**
 * Client-side authorization watchdog. The server layout only re-checks approval
 * on a full page load, so during client-side (SPA) navigation a user whose access
 * was just revoked could keep clicking around. This re-checks the DB-backed
 * approval status on every route change and every 30s; if the user is no longer
 * approved they are sent to /pending immediately, and if their session died they
 * are sent back through SSO login.
 */
export function AccessGuard() {
  const pathname = usePathname();

  React.useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const r = await fetch("/api/sso/refresh", { cache: "no-store" });
        if (!active) return;
        if (r.status === 401) {
          window.location.href =
            "/api/sso/login?next=" + encodeURIComponent(window.location.pathname);
          return;
        }
        const d = await r.json().catch(() => ({}));
        if (active && d && d.approved === false) {
          window.location.href = "/pending";
        }
      } catch {
        /* ignore transient errors */
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [pathname]);

  return null;
}
