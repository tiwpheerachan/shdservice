"use client";

import * as React from "react";
import { Clock, RefreshCw, LogOut, BadgeCheck, Mail } from "lucide-react";
import { Logo } from "@/components/shared/logo";

type Me = { name: string; email: string; avatar?: string };

export default function PendingPage() {
  const [me, setMe] = React.useState<Me | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [checkedAt, setCheckedAt] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/sso/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user && setMe(d.user))
      .catch(() => {});
  }, []);

  const check = React.useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch("/api/sso/refresh", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (d?.approved) {
        window.location.href = "/jobs/dashboard";
        return;
      }
      const n = new Date();
      const p = (x: number) => String(x).padStart(2, "0");
      setCheckedAt(`${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`);
    } catch {
      /* ignore */
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [check]);

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 text-foreground">
      {/* ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(circle, #43a6f8 0%, #55d5a1 55%, transparent 70%)" }}
      />

      <div className="relative flex w-full max-w-md flex-col items-center">
        <Logo className="mb-9 h-9 w-auto" />

        <div className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          {/* gradient top bar */}
          <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg,#43a6f8,#55d5a1)" }} />

          <div className="p-7">
            <div className="relative mx-auto mb-5 grid h-16 w-16 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-warning/20" />
              <span className="relative grid h-16 w-16 place-items-center rounded-full bg-warning-soft text-warning ring-8 ring-warning/5">
                <Clock className="h-8 w-8" />
              </span>
            </div>

            <h1 className="text-center text-xl font-bold tracking-tight">รอการอนุมัติเข้าใช้งาน</h1>
            <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-relaxed text-muted-foreground">
              คุณยืนยันตัวตนสำเร็จแล้ว แต่ผู้ดูแลระบบยังไม่ได้กำหนดสิทธิ์ให้บัญชีนี้
              โปรดรอการอนุมัติ ระบบจะพาเข้าใช้งานทันทีเมื่อได้รับสิทธิ์
            </p>

            {me && (
              <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3">
                {me.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={me.avatar}
                    alt={me.name}
                    className="h-11 w-11 rounded-full object-cover ring-2 ring-background"
                  />
                ) : (
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
                    {me.name?.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{me.name}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <Mail className="h-3 w-3 shrink-0" />
                    {me.email}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-warning-soft px-2.5 py-1 text-2xs font-medium text-warning">
                  รออนุมัติ
                </span>
              </div>
            )}

            <button
              onClick={check}
              disabled={checking}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: "linear-gradient(90deg,#43a6f8,#55d5a1)" }}
            >
              <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
              ตรวจสอบสถานะการอนุมัติ
            </button>

            <a
              href="/api/sso/logout"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              ออกจากระบบ
            </a>

            <p className="mt-5 flex items-center justify-center gap-1.5 text-2xs text-muted-foreground">
              <BadgeCheck className="h-3.5 w-3.5 text-success" />
              ตรวจสอบอัตโนมัติทุก 15 วินาที
              {checkedAt ? ` · ล่าสุด ${checkedAt}` : ""}
            </p>
          </div>
        </div>

        <p className="mt-6 text-2xs text-muted-foreground">© 2026 SHD Technology Co., Ltd.</p>
      </div>
    </main>
  );
}
