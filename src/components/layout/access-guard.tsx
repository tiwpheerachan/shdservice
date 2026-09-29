"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccess } from "@/lib/use-access";
import { ALL_LINKS } from "@/lib/nav";
import { hardNavigate, toLogin } from "@/lib/navigation";
import { useMe } from "@/lib/use-me";

/**
 * Client-side authorization watchdog. The server layout only re-checks approval
 * on a full page load, so during client-side (SPA) navigation a user whose access
 * was just revoked could keep clicking around. This re-checks the DB-backed
 * session + approval on every route change and every minute — WITHOUT renewing the
 * session; if the user is no longer approved they are sent to /pending, and if
 * their session died they are sent to /login.
 */
export function AccessGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const { canPath } = useAccess();

  // Page-level permission (app_config `view`): a user who types a URL they may
  // not open is sent to the first menu they can see. The API enforces the same
  // grants on every write regardless.
  React.useEffect(() => {
    if (canPath(pathname)) return;
    const first = ALL_LINKS.find((l) => canPath(l.href));
    router.replace(first ? first.href : "/pending");
  }, [pathname, canPath, router]);

  // still signed in / still approved? — read from /api/sso/me, which never extends the session
  // (so 30 min without activity really ends it). Every minute while the tab is visible, and at once
  // on every page change.
  const me = useMe({ poll: 60_000 });
  const { refresh } = me;
  React.useEffect(() => {
    void refresh();
  }, [pathname, refresh]);
  React.useEffect(() => {
    if (me.unauthorized) toLogin(); // expired / signed out on another device
    else if (me.approved === false) hardNavigate("/pending"); // approval revoked → reload into the pending page
  }, [me.unauthorized, me.approved]);

  return null;
}
