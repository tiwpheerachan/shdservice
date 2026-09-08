"use client";

import * as React from "react";
import { Clock, RefreshCw, LogOut, Mail, BadgeCheck } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { AuthSplit } from "@/components/ui/sign-in";

type Me = { name: string; email: string; avatar?: string };

const HERO = "/hero-shd.jpg";

export default function PendingPage() {
  const [me, setMe] = React.useState<Me | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [checkedAt, setCheckedAt] = React.useState<string | null>(null);
  const preview =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("preview");

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
      if (d?.approved && !preview) {
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
  }, [preview]);

  React.useEffect(() => {
    if (preview) return;
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [check, preview]);

  return (
    <main className="auth-page">
      <AuthSplit heroImageSrc={HERO} fit="contain">
        <div className="flex flex-col gap-6">
          <Logo variant="navy" className="h-9 w-auto self-start animate-element" />

          <div className="animate-element animate-delay-100 flex items-center gap-4">
            <span className="relative grid h-14 w-14 shrink-0 place-items-center">
              {/* soft brand glow */}
              <span
                className="absolute inset-0 rounded-2xl opacity-40 blur-lg"
                style={{ background: "linear-gradient(135deg,#43a6f8,#55d5a1)" }}
              />
              {/* pulsing ring */}
              <span className="absolute inset-0 animate-ping rounded-2xl bg-primary/15" />
              <span
                className="relative grid h-14 w-14 place-items-center rounded-2xl text-white shadow-lg ring-1 ring-inset ring-white/20"
                style={{ background: "linear-gradient(135deg,#43a6f8,#55d5a1)" }}
              >
                <Clock className="h-7 w-7" />
              </span>
            </span>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              รอการอนุมัติเข้าใช้งาน
            </h1>
          </div>

          <p className="animate-element animate-delay-200 text-sm leading-relaxed text-muted-foreground">
            คุณยืนยันตัวตนสำเร็จแล้ว แต่ผู้ดูแลระบบยังไม่ได้กำหนดสิทธิ์ให้บัญชีนี้
            ระบบจะพาเข้าใช้งานทันทีเมื่อได้รับอนุมัติ
          </p>

          {me && (
            <div className="animate-element animate-delay-300 flex items-center gap-3 rounded-2xl border border-border bg-muted/40 p-3">
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
              <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-1 text-2xs font-medium text-primary">
                รออนุมัติ
              </span>
            </div>
          )}

          <div className="animate-element animate-delay-400 flex flex-col gap-3">
            <button
              onClick={check}
              disabled={checking}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: "linear-gradient(90deg,#43a6f8,#55d5a1)" }}
            >
              <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
              ตรวจสอบสถานะการอนุมัติ
            </button>

            <a
              href="/api/sso/logout"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              ออกจากระบบ
            </a>

            <p className="flex items-center justify-center gap-1.5 text-2xs text-muted-foreground">
              <BadgeCheck className="h-3.5 w-3.5 text-success" />
              ตรวจสอบอัตโนมัติทุก 15 วินาที
              {checkedAt ? ` · ล่าสุด ${checkedAt}` : ""}
            </p>
          </div>
        </div>
      </AuthSplit>
    </main>
  );
}
