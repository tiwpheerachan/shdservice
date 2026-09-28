"use client";

import * as React from "react";
import { ArrowLeft, ChevronRight, Loader2, LogOut, MessageSquareText, Phone, ShieldCheck, Timer } from "lucide-react";
import { TRACK_MSG, type PublicJob, type PublicJobSummary } from "@/lib/track-public";
import { PublicJobView } from "./public-job-view";
import { cn } from "@/lib/utils";

/**
 * /track after the Cloudflare gate: phone → SMS OTP → this customer's jobs.
 *
 * The session token lives ONLY in this component's memory (a ref) and travels in the
 * `x-track-session` header — refresh / close / come back later = a new OTP. The session
 * starts at 15 minutes; while the customer is actually using the page the keepalive keeps
 * at least 5 minutes on the clock, up to 60 minutes from sign-in (server-enforced).
 */
type Step = "phone" | "code" | "list" | "detail";
type Tab = "active" | "history";

const SESSION_HEADER = "x-track-session";
const ACTIVE_WINDOW_MS = 60_000; // "using the page" = input in the last minute
const KEEPALIVE_WHEN_LEFT_MS = 5.5 * 60_000;

async function call<T>(path: string, init: RequestInit & { session?: string } = {}) {
  const { session, ...rest } = init;
  const r = await fetch(path, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(session ? { [SESSION_HEADER]: session } : {}), ...(rest.headers ?? {}) },
    cache: "no-store",
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
  });
  const d = (await r.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; reason?: string };
  return { status: r.status, d };
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function TrackOtp({
  getToken,
  verifying,
  devOtpLog,
}: {
  /** a fresh single-use Turnstile token (the gate's, or a background one) — null when unavailable */
  getToken: () => Promise<string | null>;
  /** a background captcha check is running */
  verifying: boolean;
  /** development: the OTP goes to the server log instead of an SMS */
  devOtpLog: boolean;
}) {
  const [step, setStep] = React.useState<Step>("phone");
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [masked, setMasked] = React.useState("");
  const [requestId, setRequestId] = React.useState("");
  const [resendAt, setResendAt] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [tab, setTab] = React.useState<Tab>("active");
  const [lists, setLists] = React.useState<{ active: PublicJobSummary[]; history: PublicJobSummary[] }>({ active: [], history: [] });
  const [job, setJob] = React.useState<PublicJob | null>(null);
  const [expiresAt, setExpiresAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const session = React.useRef<string | null>(null);
  const lastInput = React.useRef(Date.now());
  const lastKeepalive = React.useRef(0);

  const signOut = React.useCallback((message = "") => {
    const s = session.current;
    session.current = null;
    if (s) void call("/api/track/me", { method: "DELETE", session: s }).catch(() => {});
    setJob(null);
    setLists({ active: [], history: [] });
    setCode("");
    setRequestId("");
    setExpiresAt(0);
    setError(message);
    setStep("phone");
  }, []);

  /* ---------- clock, activity, keepalive ---------- */
  React.useEffect(() => {
    const mark = () => (lastInput.current = Date.now());
    const evts = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    evts.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      evts.forEach((e) => window.removeEventListener(e, mark));
      clearInterval(tick);
    };
  }, []);

  React.useEffect(() => {
    if (!session.current || !expiresAt) return;
    if (now >= expiresAt) {
      signOut(TRACK_MSG.sessionExpired);
      return;
    }
    // in use and running low → ask the server for more time (it caps at 60 min from sign-in)
    const inUse = now - lastInput.current < ACTIVE_WINDOW_MS;
    if (inUse && expiresAt - now < KEEPALIVE_WHEN_LEFT_MS && now - lastKeepalive.current > 30_000) {
      lastKeepalive.current = now;
      void call<{ expiresAt?: string }>("/api/track/me/keepalive", { method: "POST", session: session.current }).then(({ status, d }) => {
        if (status === 401) signOut(TRACK_MSG.sessionExpired);
        else if (d.expiresAt) setExpiresAt(Date.parse(d.expiresAt));
      });
    }
  }, [now, expiresAt, signOut]);

  /* ---------- actions ---------- */
  const requestCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const turnstileToken = await getToken();
      if (!turnstileToken) throw new Error(TRACK_MSG.unavailable);
      const { d } = await call<{ requestId?: string; masked?: string; resendIn?: number }>("/api/track/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone, turnstileToken }),
      });
      if (!d.ok || !d.requestId) throw new Error(d.error ?? TRACK_MSG.sessionFail);
      setRequestId(d.requestId);
      setMasked(d.masked ?? "");
      setResendAt(Date.now() + (d.resendIn ?? 60) * 1000);
      setCode("");
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : TRACK_MSG.sessionFail);
    } finally {
      setBusy(false);
    }
  };

  const loadList = async (token: string) => {
    const { status, d } = await call<{ active?: PublicJobSummary[]; history?: PublicJobSummary[]; expiresAt?: string }>("/api/track/me", { session: token });
    if (status === 401 || !d.ok) {
      signOut(d.error ?? TRACK_MSG.sessionExpired);
      return;
    }
    setLists({ active: d.active ?? [], history: d.history ?? [] });
    if (d.expiresAt) setExpiresAt(Date.parse(d.expiresAt));
    setTab((d.active ?? []).length ? "active" : "history");
    setStep("list");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { d } = await call<{ session?: string; expiresAt?: string }>("/api/track/otp/verify", {
        method: "POST",
        body: JSON.stringify({ requestId, code }),
      });
      if (!d.ok || !d.session) throw new Error(d.error ?? TRACK_MSG.otpFail);
      session.current = d.session;
      lastInput.current = Date.now();
      if (d.expiresAt) setExpiresAt(Date.parse(d.expiresAt));
      await loadList(d.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : TRACK_MSG.otpFail);
    } finally {
      setBusy(false);
    }
  };

  const openJob = async (no: string) => {
    if (!session.current) return;
    setBusy(true);
    setError("");
    try {
      const { status, d } = await call<{ job?: PublicJob; expiresAt?: string }>(`/api/track/me/jobs/${encodeURIComponent(no)}`, { session: session.current });
      if (status === 401) return signOut(TRACK_MSG.sessionExpired);
      if (!d.ok || !d.job) throw new Error(d.error ?? "ไม่พบรายการ");
      setJob(d.job);
      if (d.expiresAt) setExpiresAt(Date.parse(d.expiresAt));
      setStep("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่พบรายการ");
    } finally {
      setBusy(false);
    }
  };

  /* ---------- views ---------- */
  const errorBox = error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>;
  const inputCls =
    "num h-11 w-full rounded-md border border-input bg-background px-3 text-base tracking-wide outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
  const btnCls =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";

  if (step === "phone" || step === "code") {
    const waitMs = resendAt - now;
    return (
      <div className="surface mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold tracking-tight">ติดตามสถานะงานซ่อม</h1>
        {step === "phone" ? (
          <form onSubmit={requestCode} className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">กรอกเบอร์มือถือที่ให้ไว้กับศูนย์บริการ ระบบจะส่งรหัส OTP ทาง SMS เพื่อยืนยันตัวตน</p>
            <div>
              <label htmlFor="phone" className="mb-1 block text-xs font-medium">
                เบอร์มือถือ
              </label>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d+\- ]/g, "").slice(0, 16))}
                  placeholder="0812345678"
                  inputMode="tel"
                  autoComplete="tel"
                  className={cn(inputCls, "pl-9")}
                />
              </div>
            </div>
            {errorBox}
            <button type="submit" disabled={busy || verifying || phone.replace(/\D/g, "").length < 9} className={btnCls}>
              {busy || verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
              {verifying ? "กำลังตรวจสอบความปลอดภัย…" : "ขอรหัส OTP"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              ส่งรหัส 6 หลักไปที่ <span className="num font-medium text-foreground">{masked}</span> แล้ว (ถ้าเบอร์นี้อยู่ในระบบ) · รหัสใช้ได้ 5 นาที
            </p>
            <div>
              <label htmlFor="otp" className="mb-1 block text-xs font-medium">
                รหัส OTP
              </label>
              <input
                id="otp"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                className={cn(inputCls, "text-center text-xl tracking-[0.5em]")}
              />
            </div>
            {errorBox}
            <button type="submit" disabled={busy || code.length !== 6} className={btnCls}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              ยืนยันรหัส
            </button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={() => signOut()} className="text-muted-foreground hover:text-foreground">
                เปลี่ยนเบอร์
              </button>
              <button
                type="button"
                onClick={() => void requestCode()}
                disabled={busy || verifying || waitMs > 0}
                className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                {waitMs > 0 ? `ขอรหัสใหม่ได้ใน ${Math.ceil(waitMs / 1000)} วินาที` : "ขอรหัสใหม่"}
              </button>
            </div>
          </form>
        )}
        {devOtpLog && (
          <p className="mt-4 rounded-md border border-dashed border-warning/50 px-3 py-2 text-2xs text-warning">
            โหมดทดสอบ: ยังไม่ส่ง SMS จริง — รหัส OTP แสดงใน log ของ server ([sms:log])
          </p>
        )}
      </div>
    );
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Timer className="h-3.5 w-3.5" /> เหลือเวลา <span className="num font-medium text-foreground">{mmss(expiresAt - now)}</span>
        <span className="hidden sm:inline">· ต่อเวลาอัตโนมัติเมื่อใช้งานอยู่</span>
      </span>
      <button type="button" onClick={() => signOut()} className="inline-flex items-center gap-1 hover:text-foreground">
        <LogOut className="h-3.5 w-3.5" /> ออก
      </button>
    </div>
  );

  if (step === "detail" && job) {
    return (
      <div className="space-y-3">
        {header}
        <button type="button" onClick={() => setStep("list")} className="inline-flex items-center gap-1.5 px-1 text-sm font-medium text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> กลับไปรายการงาน
        </button>
        <PublicJobView j={job} />
      </div>
    );
  }

  const rows = tab === "active" ? lists.active : lists.history;
  return (
    <div className="space-y-3">
      {header}
      <div className="surface overflow-hidden">
        <div className="flex border-b border-border">
          {(
            [
              ["active", "กำลังดำเนินการ", lists.active.length],
              ["history", "ประวัติ", lists.history.length],
            ] as const
          ).map(([k, label, n]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                "flex-1 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {label} <span className="num">({n})</span>
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            {tab === "active" ? "ไม่มีงานที่กำลังดำเนินการ" : "ไม่มีประวัติงานในช่วง 2 ปีที่ผ่านมา"}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.no}>
                <button
                  type="button"
                  onClick={() => void openJob(r.no)}
                  disabled={busy}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent/40 disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="num text-sm font-semibold">{r.no}</span>
                      <span className="truncate text-sm">{r.brandModel || "—"}</span>
                    </p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {r.deviceRef && <span className="num">S/N {r.deviceRef} · </span>}
                      รับเครื่อง <span className="num">{r.receivedDate || "—"}</span>
                      {r.closedDate && (
                        <>
                          {" · "}ปิดงาน <span className="num">{r.closedDate}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-0.5 text-2xs font-medium",
                      r.cancelled ? "bg-danger-soft text-danger" : tab === "history" ? "bg-success-soft text-success" : "bg-primary-soft text-primary"
                    )}
                  >
                    {r.stepLabel}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {errorBox}
    </div>
  );
}
