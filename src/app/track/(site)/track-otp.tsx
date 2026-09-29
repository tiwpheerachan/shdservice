"use client";

import * as React from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, LogOut, MessageSquareText, Phone, Search, ShieldCheck, Timer, X } from "lucide-react";
import { TRACK_MSG, TRACK_STEPS, type PublicJob, type PublicJobSummary } from "@/lib/track-public";
import { Input, Select } from "@/components/ui/input";
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
/** job list rows per page (each tab keeps its own page, also across opening a job and coming back) */
const PAGE_SIZE = 5;

/** list filters — applied in the browser to the list the server already scoped to this customer */
type Filters = { q: string; status: string; from: string; to: string };
const NO_FILTERS: Filters = { q: "", status: "", from: "", to: "" };
const statusKey = (r: PublicJobSummary) => (r.cancelled ? "cancelled" : r.step ?? "");
function matches(r: PublicJobSummary, f: Filters) {
  const q = f.q.trim().toLowerCase();
  if (q && ![r.no, r.brandModel, r.deviceRef.replace(/•/g, "")].some((v) => v.toLowerCase().includes(q))) return false;
  if (f.status && statusKey(r) !== f.status) return false;
  // YYYY-MM-DD strings compare as dates
  if (f.from && (!r.receivedDate || r.receivedDate < f.from)) return false;
  if (f.to && (!r.receivedDate || r.receivedDate > f.to)) return false;
  return true;
}

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

const OTP_LENGTH = 6;
const EMPTY_CODE: string[] = Array(OTP_LENGTH).fill("");

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
  const [code, setCode] = React.useState<string[]>(EMPTY_CODE);
  /** bumped after a wrong code → the boxes clear and the first one takes focus */
  const [codeReset, setCodeReset] = React.useState(0);
  const [masked, setMasked] = React.useState("");
  const [requestId, setRequestId] = React.useState("");
  const [resendAt, setResendAt] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [tab, setTab] = React.useState<Tab>("active");
  const [pages, setPages] = React.useState<Record<Tab, number>>({ active: 1, history: 1 });
  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS);
  const [lists, setLists] = React.useState<{ active: PublicJobSummary[]; history: PublicJobSummary[] }>({ active: [], history: [] });
  const [job, setJob] = React.useState<PublicJob | null>(null);
  const [expiresAt, setExpiresAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const session = React.useRef<string | null>(null);
  const lastInput = React.useRef(0); // stamped on mount below (no Date.now() during render)
  const lastKeepalive = React.useRef(0);

  const signOut = React.useCallback((message = "") => {
    const s = session.current;
    session.current = null;
    if (s) void call("/api/track/me", { method: "DELETE", session: s }).catch(() => {});
    setJob(null);
    setLists({ active: [], history: [] });
    setCode(EMPTY_CODE);
    setRequestId("");
    setExpiresAt(0);
    setError(message);
    setStep("phone");
  }, []);

  /* ---------- clock, activity, keepalive ---------- */
  React.useEffect(() => {
    lastInput.current = Date.now();
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
      setCode(EMPTY_CODE);
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
    setPages({ active: 1, history: 1 });
    setFilters(NO_FILTERS);
    setStep("list");
  };

  /** called by the boxes as soon as the 6th digit is in — no confirm button */
  const verify = async (value: string) => {
    if (busy || !/^\d{6}$/.test(value)) return;
    setBusy(true);
    setError("");
    try {
      const { d } = await call<{ session?: string; expiresAt?: string }>("/api/track/otp/verify", {
        method: "POST",
        body: JSON.stringify({ requestId, code: value }),
      });
      if (!d.ok || !d.session) throw new Error(d.error ?? TRACK_MSG.otpFail);
      session.current = d.session;
      lastInput.current = Date.now();
      if (d.expiresAt) setExpiresAt(Date.parse(d.expiresAt));
      await loadList(d.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : TRACK_MSG.otpFail);
      setCode(EMPTY_CODE);
      setCodeReset((n) => n + 1);
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
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              ส่งรหัส 6 หลักไปที่ <span className="num font-medium text-foreground">{masked}</span> แล้ว (ถ้าเบอร์นี้อยู่ในระบบ) · รหัสใช้ได้ 5 นาที
            </p>
            <div>
              <p className="mb-2 text-xs font-medium">รหัส OTP</p>
              <OtpBoxes value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} resetKey={codeReset} />
              <p className="mt-2 flex h-5 items-center justify-center gap-1.5 text-xs text-muted-foreground">
                {busy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังตรวจสอบรหัส…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" /> กรอกครบ 6 หลักแล้วระบบจะยืนยันให้อัตโนมัติ
                  </>
                )}
              </p>
            </div>
            {errorBox}
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
          </div>
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

  // documents: the session authorises them — the server checks the job is this customer's
  const openDoc = async (d: { kind: string; ref: string }) => {
    const s = session.current;
    if (!s || !job) return {};
    lastInput.current = Date.now();
    const { status, d: r } = await call<{ url?: string }>("/api/track/doc", {
      method: "POST",
      session: s,
      body: JSON.stringify({ jobNo: job.no, kind: d.kind, ref: d.ref }),
    });
    if (status === 401) {
      signOut(TRACK_MSG.sessionExpired);
      return {};
    }
    return { url: r.ok ? r.url : undefined, error: r.error };
  };

  if (step === "detail" && job) {
    return (
      <div className="space-y-3">
        {header}
        <button type="button" onClick={() => setStep("list")} className="inline-flex items-center gap-1.5 px-1 text-sm font-medium text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> กลับไปรายการงาน
        </button>
        <PublicJobView j={job} onOpenDoc={openDoc} />
      </div>
    );
  }

  const tabRows = tab === "active" ? lists.active : lists.history;
  const all = tabRows.filter((r) => matches(r, filters));
  const filtered = Object.values(filters).some((v) => v.trim() !== "");
  const setFilter = (k: keyof Filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPages({ active: 1, history: 1 });
  };
  // status options: only what this tab actually holds, in timeline order, with counts
  const statusOptions = [
    ...TRACK_STEPS.map((s) => ({ key: s.key as string, label: s.label })),
    { key: "cancelled", label: "ยกเลิกรายการ" },
  ]
    .map((o) => ({ ...o, n: tabRows.filter((r) => statusKey(r) === o.key).length }))
    .filter((o) => o.n > 0);
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(pages[tab], totalPages);
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const goPage = (n: number) => setPages((p) => ({ ...p, [tab]: Math.min(totalPages, Math.max(1, n)) }));
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
              onClick={() => {
                setTab(k);
                setFilters((f) => ({ ...f, status: "" })); // statuses differ per tab
              }}
              className={cn(
                "flex-1 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {label} <span className="num">({filtered ? lists[k].filter((r) => matches(r, filters)).length : n})</span>
            </button>
          ))}
        </div>
        {tabRows.length > 0 && (
          <div className="grid gap-2 border-b border-border px-5 py-3 sm:grid-cols-2">
            <label className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.q}
                onChange={(e) => setFilter("q", e.target.value)}
                placeholder="ค้นหาเลขที่งาน รุ่นสินค้า หรือ S/N 4 ตัวท้าย"
                className="pl-8"
                maxLength={50}
                aria-label="ค้นหา"
              />
            </label>
            <Select value={filters.status} onChange={(e) => setFilter("status", e.target.value)} aria-label="สถานะ">
              <option value="">ทุกสถานะ</option>
              {statusOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label} ({o.n})
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <Input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter("from", e.target.value)} aria-label="รับเครื่องตั้งแต่วันที่" />
              <span className="shrink-0 text-xs text-muted-foreground">ถึง</span>
              <Input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter("to", e.target.value)} aria-label="รับเครื่องถึงวันที่" />
            </div>
            {filtered && (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground sm:col-span-2">
                <span>
                  พบ <span className="num">{all.length}</span> จาก <span className="num">{tabRows.length}</span> รายการ · วันที่ = วันที่รับเครื่อง
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFilters(NO_FILTERS);
                    setPages({ active: 1, history: 1 });
                  }}
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  <X className="h-3.5 w-3.5" /> ล้างตัวกรอง
                </button>
              </div>
            )}
          </div>
        )}
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            {tabRows.length > 0
              ? "ไม่พบรายการที่ตรงกับตัวกรอง"
              : tab === "active"
                ? "ไม่มีงานที่กำลังดำเนินการ"
                : "ไม่มีประวัติงานในช่วง 2 ปีที่ผ่านมา"}
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
        {all.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
            <span className="num">
              แสดง {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, all.length)} จาก {all.length} รายการ
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => goPage(page - 1)}
                disabled={page === 1}
                className="rounded-md border border-border p-1.5 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label="ก่อนหน้า"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="num min-w-[70px] text-center">
                หน้า {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => goPage(page + 1)}
                disabled={page >= totalPages}
                className="rounded-md border border-border p-1.5 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label="ถัดไป"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
      {errorBox}
    </div>
  );
}

/**
 * 6 one-digit boxes: a digit moves to the next box, Backspace on an empty box goes back,
 * ← / → move, and a pasted or SMS-autofilled code (iOS / Android "one-time-code") spreads
 * over the boxes. The 6th digit calls onComplete — there is no confirm button.
 */
function OtpBoxes({
  value,
  onChange,
  onComplete,
  disabled,
  resetKey,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  onComplete: (code: string) => void;
  disabled: boolean;
  resetKey: number;
}) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(OTP_LENGTH - 1, i))];
    el?.focus();
    el?.select();
  };

  // first box on mount and after a wrong code
  React.useEffect(() => {
    focus(0);
  }, [resetKey]);

  /** put `digits` in from box `at` onward; complete → submit */
  const fill = (at: number, digits: string) => {
    const next = [...value];
    for (let k = 0; k < digits.length && at + k < OTP_LENGTH; k++) next[at + k] = digits[k];
    onChange(next);
    if (next.every((d) => d !== "")) {
      refs.current[Math.min(at + digits.length, OTP_LENGTH) - 1]?.blur();
      onComplete(next.join(""));
    } else {
      focus(at + digits.length);
    }
  };

  return (
    <div className="flex justify-center gap-2" role="group" aria-label="รหัส OTP 6 หลัก">
      {value.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`รหัสหลักที่ ${i + 1}`}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            if (!digits) {
              const next = [...value];
              next[i] = "";
              onChange(next);
              return;
            }
            if (digits.length >= OTP_LENGTH) return fill(0, digits.slice(0, OTP_LENGTH)); // SMS autofill: the whole code
            if (d && digits.length === 2) return fill(i, digits[0] === d ? digits[1] : digits[0]); // typed over an unselected digit
            fill(i, digits); // one typed digit (the old one was selected) or a partial paste
          }}
          onPaste={(e) => {
            const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
            if (!digits) return;
            e.preventDefault();
            fill(digits.length === OTP_LENGTH ? 0 : i, digits);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d && i > 0) {
              e.preventDefault();
              const next = [...value];
              next[i - 1] = "";
              onChange(next);
              focus(i - 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              focus(i - 1);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              focus(i + 1);
            }
          }}
          className={cn(
            "num h-12 w-11 rounded-md border border-input bg-background text-center text-xl font-semibold outline-hidden transition-[border-color,box-shadow]",
            "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-60",
            d && "border-primary/60"
          )}
        />
      ))}
    </div>
  );
}
