"use client";

import * as React from "react";
import Image from "next/image";
import { Clock, RefreshCw, LogOut, ShieldAlert } from "lucide-react";

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
      const now = new Date();
      setCheckedAt(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
      );
    } catch {
      /* ignore */
    } finally {
      setChecking(false);
    }
  }, []);

  // auto-poll for approval every 15s
  React.useEffect(() => {
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [check]);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <div className="flex w-full max-w-md flex-col items-center">
        <Image
          src="/logo.png"
          alt="OneService"
          width={200}
          height={56}
          className="mb-8 h-12 w-auto"
          priority
        />

        <div className="w-full rounded-2xl border border-border bg-card p-7 shadow-sm">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-warning-soft text-warning">
            <Clock className="h-7 w-7" />
          </div>

          <h1 className="text-center text-lg font-semibold">บัญชีของคุณรอการอนุมัติ</h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            คุณเข้าสู่ระบบสำเร็จแล้ว แต่ผู้ดูแลระบบยังไม่ได้กำหนดสิทธิ์การใช้งานให้บัญชีนี้
            กรุณาติดต่อผู้ดูแลระบบเพื่อขออนุมัติ
          </p>

          {me && (
            <div className="mt-5 flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
              {me.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={me.avatar}
                  alt={me.name}
                  className="h-10 w-10 rounded-full object-cover ring-1 ring-border"
                />
              ) : (
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                  {me.name?.slice(0, 2).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{me.name}</p>
                <p className="truncate text-xs text-muted-foreground">{me.email}</p>
              </div>
            </div>
          )}

          <button
            onClick={check}
            disabled={checking}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
            ตรวจสอบสถานะอีกครั้ง
          </button>

          <a
            href="/api/sso/logout"
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            ออกจากระบบ
          </a>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-2xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" />
            ระบบจะตรวจสอบให้อัตโนมัติทุก 15 วินาที
            {checkedAt ? ` · ล่าสุด ${checkedAt}` : ""}
          </p>
        </div>

        <p className="mt-6 text-2xs text-muted-foreground">© 2026 SHD Technology Co., Ltd.</p>
      </div>
    </main>
  );
}
