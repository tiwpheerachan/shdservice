"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useConfirm, type ConfirmOptions } from "@/components/ui/confirm";

/**
 * Unsaved changes — leaving a form with edits that were never saved asks first.
 *
 *  - a form says whether it has unsaved edits: `useUnsavedChanges(dirty)` (value ≠ what was loaded / saved)
 *  - `useLeave()` — the form's "ยกเลิก" and the ⌘K menu: go to a page, asking first when something is unsaved
 *  - `useUnsavedChangesGuard()` (AppShell, once) — the same question for every in-app link, and the
 *    browser's own "leave site?" for closing the tab / reload / typing another URL
 *
 * The browser's back / forward buttons are not covered (the app router offers no way to hold them).
 */

const checks = new Map<symbol, () => boolean>();
let unloadAllowed = false;

export function hasUnsavedChanges() {
  for (const dirty of checks.values()) if (dirty()) return true;
  return false;
}

/** a full page load the app starts itself (session gone → /login, new permissions) — no "leave site?" */
export function allowUnload() {
  unloadAllowed = true;
}

/** this form has edits that were never saved (a boolean, or a check run at the moment someone leaves) */
export function useUnsavedChanges(dirty: boolean | (() => boolean)) {
  const latest = React.useRef(dirty);
  React.useLayoutEffect(() => {
    latest.current = dirty;
  });
  React.useLayoutEffect(() => {
    const id = Symbol("unsaved");
    checks.set(id, () => {
      const d = latest.current;
      return typeof d === "function" ? d() : d;
    });
    return () => {
      checks.delete(id);
    };
  }, []);
}

const LEAVE: ConfirmOptions = {
  tone: "danger",
  title: "ออกโดยไม่บันทึก?",
  description: "ข้อมูลที่แก้ไขในหน้านี้ยังไม่ได้บันทึก ถ้าออกตอนนี้ ข้อมูลที่แก้ไขจะหายไป",
  confirmLabel: "ออกโดยไม่บันทึก",
  cancelLabel: "อยู่ต่อ",
};

/** go to `href` — asks first when a form on this page has unsaved edits; true = went */
export function useLeave() {
  const router = useRouter();
  const confirm = useConfirm();
  return React.useCallback(
    async (href: string) => {
      if (hasUnsavedChanges() && !(await confirm(LEAVE))) return false;
      router.push(href);
      return true;
    },
    [router, confirm]
  );
}

/** in-app links + closing / reloading the tab — mounted once by AppShell */
export function useUnsavedChangesGuard() {
  const confirm = useConfirm();
  const router = useRouter();

  React.useEffect(() => {
    // closing the tab, reload, another URL: the browser shows its own "leave site?" (its text can't be set)
    const onUnload = (e: BeforeUnloadEvent) => {
      if (unloadAllowed || !hasUnsavedChanges()) return;
      e.preventDefault();
      e.returnValue = ""; // Safari / older Chrome still need it
    };

    // an in-app link (sidebar, breadcrumbs, bell…): held before next/link sees the click, asked, then
    // clicked again so the link does exactly what it would have done (closes the mobile menu too)
    // — or, when its menu has closed meanwhile, opened by the router
    let replaying = false;
    const onClick = (e: MouseEvent) => {
      if (replaying || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const to = new URL(a.href, window.location.href);
      if (to.origin !== window.location.origin) return;
      if (to.pathname === window.location.pathname && to.search === window.location.search) return; // this page / #anchor
      if (!hasUnsavedChanges()) return;
      e.preventDefault();
      e.stopPropagation();
      void confirm(LEAVE).then((ok) => {
        if (!ok) return;
        if (!a.isConnected) return router.push(to.pathname + to.search + to.hash); // its menu closed meanwhile
        replaying = true;
        try {
          const handled = !a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          if (!handled) allowUnload(); // a plain <a>: the browser loads the page — already answered
        } finally {
          replaying = false;
        }
      });
    };

    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("click", onClick, true);
    };
  }, [confirm, router]);
}
