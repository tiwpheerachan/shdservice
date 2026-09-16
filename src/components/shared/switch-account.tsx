"use client";

import * as React from "react";
import { UserRoundCog, Loader2 } from "lucide-react";
import { SSO } from "@/lib/sso";

// Central SSO keeps its own sso_session cookie and ignores prompt=login, so
// "เข้าสู่ระบบด้วยบัญชีอื่น" must first sign out of the SSO itself. Its logout is a
// POST that must be a top-level navigation (the cookie is SameSite=Lax, so a
// fetch/iframe cannot clear it) and does not accept a return URL — so we submit
// the form into a new tab, then send this tab back through /api/sso/login, which
// now lands on the SSO login page (with next= back to our callback).
const DELAY_MS = 2500;

export function SwitchAccountButton({ next, className }: { next: string; className: string }) {
  const [phase, setPhase] = React.useState<"idle" | "wait">("idle");
  const loginUrl = `/api/sso/login?next=${encodeURIComponent(next)}&prompt=login`;

  const proceed = React.useCallback(() => {
    window.location.href = loginUrl;
  }, [loginUrl]);

  React.useEffect(() => {
    if (phase !== "wait") return;
    const t = window.setTimeout(proceed, DELAY_MS);
    return () => window.clearTimeout(t);
  }, [phase, proceed]);

  const start = () => {
    // must run synchronously inside the click so the new tab is not popup-blocked
    const f = document.createElement("form");
    f.method = "post";
    f.action = SSO.logoutUrl;
    f.target = "_blank";
    f.rel = "noopener";
    f.style.display = "none";
    document.body.appendChild(f);
    f.submit();
    f.remove();
    setPhase("wait");
  };

  if (phase === "wait") {
    return (
      <div className="animate-element flex flex-col gap-2">
        <button type="button" onClick={proceed} className={className}>
          <Loader2 className="h-4 w-4 animate-spin" />
          กำลังออกจากระบบกลาง… กดเพื่อดำเนินการต่อ
        </button>
        <p className="text-center text-2xs text-muted-foreground">
          ปิดแท็บ SSO ที่เปิดขึ้นมาได้เลย ระบบจะพาไปหน้าเข้าสู่ระบบด้วยบัญชีใหม่โดยอัตโนมัติ
        </p>
      </div>
    );
  }

  return (
    <button type="button" onClick={start} className={className}>
      <UserRoundCog className="h-4 w-4" />
      เข้าสู่ระบบด้วยบัญชีอื่น
    </button>
  );
}
