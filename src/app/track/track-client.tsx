"use client";

import * as React from "react";
import Script from "next/script";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { TRACK_MSG, type PublicJob } from "@/lib/track-public";
import { PublicJobView } from "./public-job-view";

/**
 * Browser side of the tracking flow:
 *
 *   gate (Cloudflare checkbox) → POST /api/track/session → { ticket } → POST /api/track/data → PublicJob
 *
 * 1. GATE — the page shows only a Turnstile checkbox (widget mode: Managed). Nothing
 *    else, not even the form, until it passes.
 * 2. link: the token goes straight to /api/track/session → ticket → data.
 *    form: the form appears; the gate token is used for the first search if it is
 *    still fresh. After that (or after 4 minutes — tokens live 5) a second,
 *    background widget (`interaction-only` + `execute`) fetches a new one on submit;
 *    it shows a checkbox only if Cloudflare asks for a click.
 *
 * Every Turnstile token is single-use (Siteverify burns it). The ticket lives only in
 * a local variable between the two calls — never in state, storage or a cookie.
 * Refresh / come back later = the gate again.
 */
type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
  execute: (idOrEl: string | HTMLElement) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
/** reuse a gate token only while it is comfortably inside its 5-minute life */
const TOKEN_FRESH_MS = 4 * 60_000;

type Props = { mode: "link"; linkToken: string; nonce?: string } | { mode: "form"; nonce?: string };
type Phase = "gate" | "ready" | "done";

async function post(path: string, body: Record<string, string>) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
  });
  return (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; ticket?: string; job?: PublicJob };
}

/** one Turnstile widget bound to a container while it is mounted */
function useTurnstile(
  el: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  ready: boolean,
  opts: () => Record<string, unknown>
) {
  const id = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!active || !ready || !SITE_KEY || !window.turnstile || !el.current || id.current) return;
    id.current = window.turnstile.render(el.current, { sitekey: SITE_KEY, action: "track", language: "th", ...opts() });
    return () => {
      if (id.current && window.turnstile) window.turnstile.remove(id.current);
      id.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ready]);
  return id;
}

export function TrackClient(props: Props) {
  const [tsReady, setTsReady] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>("gate");
  const [busy, setBusy] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [error, setError] = React.useState("");
  const [job, setJob] = React.useState<PublicJob | null>(null);
  const [no, setNo] = React.useState("");
  const [phone4, setPhone4] = React.useState("");

  const gateEl = React.useRef<HTMLDivElement>(null);
  const formEl = React.useRef<HTMLDivElement>(null);
  /** the gate's token, kept for the first search only (form mode) */
  const gateToken = React.useRef<{ t: string; at: number } | null>(null);
  /** form fields waiting for a background token */
  const pending = React.useRef<Record<string, string> | null>(null);

  // the script may already be loaded (client-side navigation between /track pages)
  React.useEffect(() => {
    if (window.turnstile) setTsReady(true);
  }, []);

  // session → ticket → data
  const run = React.useCallback(
    async (turnstileToken: string, fields: Record<string, string>) => {
      setBusy(true);
      setError("");
      try {
        const s = await post("/api/track/session", { ...fields, turnstileToken });
        if (!s.ok || !s.ticket) throw new Error(s.error ?? TRACK_MSG.sessionFail);
        // the ticket exists only inside `s` for this one call — it is single-use, spent either way
        const d = await post("/api/track/data", { ticket: s.ticket });
        if (!d.ok || !d.job) throw new Error(d.error ?? TRACK_MSG.ticketFail);
        setJob(d.job);
        setPhase("done");
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        // link: back to the checkbox; form: stay — the next search fetches a fresh token
        if (props.mode === "link") setPhase("gate");
      } finally {
        setBusy(false);
      }
    },
    [props.mode]
  );

  const linkToken = props.mode === "link" ? props.linkToken : "";
  const onGatePass = React.useRef<(t: string) => void>(() => {});
  onGatePass.current = (t: string) => {
    setError("");
    if (props.mode === "link") {
      setPhase("ready");
      void run(t, { linkToken });
    } else {
      gateToken.current = { t, at: Date.now() };
      setPhase("ready");
    }
  };
  const onFormToken = React.useRef<(t: string) => void>(() => {});
  onFormToken.current = (t: string) => {
    setVerifying(false);
    const f = pending.current;
    pending.current = null;
    if (f) void run(t, f);
  };

  // 1. the gate: a visible checkbox (Managed mode) — nothing else on the page until it passes
  useTurnstile(gateEl, phase === "gate", tsReady, () => ({
    appearance: "always",
    callback: (t: string) => onGatePass.current(t),
    "error-callback": () => setError(TRACK_MSG.unavailable),
  }));

  // 2. form mode, after the gate: a background widget that runs only when asked (execute)
  const formWidget = useTurnstile(formEl, props.mode === "form" && phase === "ready", tsReady, () => ({
    appearance: "interaction-only",
    execution: "execute",
    callback: (t: string) => onFormToken.current(t),
    "error-callback": () => {
      setVerifying(false);
      pending.current = null;
      setError(TRACK_MSG.unavailable);
    },
  }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fields = { no: no.trim(), phone4: phone4.trim() };
    const g = gateToken.current;
    gateToken.current = null; // single use
    if (g && Date.now() - g.at < TOKEN_FRESH_MS) {
      void run(g.t, fields);
      return;
    }
    // gate token used / older than 4 min → a fresh one in the background
    if (!window.turnstile || !formWidget.current) {
      setError(TRACK_MSG.unavailable);
      return;
    }
    setError("");
    setVerifying(true);
    pending.current = fields;
    window.turnstile.reset(formWidget.current);
    window.turnstile.execute(formWidget.current);
  };

  if (!SITE_KEY) {
    // no site key in this build → fail closed, never show anything without the check
    return <Notice text={TRACK_MSG.unavailable} />;
  }

  const script = (
    <Script
      src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      strategy="afterInteractive"
      nonce={props.nonce}
      onReady={() => setTsReady(true)}
    />
  );

  /* ---------- 1. gate ---------- */
  if (phase === "gate") {
    return (
      <div className="surface mx-auto max-w-md p-6 text-center">
        {script}
        <ShieldCheck className="mx-auto mb-3 h-9 w-9 text-primary" />
        <h1 className="text-base font-semibold">ยืนยันก่อนใช้งาน</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          เพื่อปกป้องข้อมูลงานซ่อมของคุณ กรุณายืนยันว่าคุณไม่ใช่โปรแกรมอัตโนมัติ
        </p>
        <div className="mt-5 flex min-h-[65px] justify-center">
          <div ref={gateEl} />
          {!tsReady && (
            <p className="inline-flex items-center gap-2 self-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด…
            </p>
          )}
        </div>
        {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  /* ---------- 3. result ---------- */
  if (phase === "done" && job) {
    return (
      <div className="space-y-4">
        <PublicJobView j={job} />
        {props.mode === "form" && (
          <button
            type="button"
            onClick={() => {
              setJob(null);
              setNo("");
              setPhone4("");
              setPhase("ready");
            }}
            className="text-sm font-medium text-primary hover:underline"
          >
            ค้นหารายการอื่น
          </button>
        )}
      </div>
    );
  }

  /* ---------- 2. link: loading the job ---------- */
  if (props.mode === "link") {
    return (
      <div className="surface mx-auto max-w-md p-6 text-center">
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดข้อมูล…
        </p>
      </div>
    );
  }

  /* ---------- 2. form ---------- */
  return (
    <div className="surface mx-auto max-w-md p-6">
      {script}
      <h1 className="text-lg font-semibold tracking-tight">ติดตามสถานะงานซ่อม</h1>
      <p className="mt-1 text-sm text-muted-foreground">กรอกเลขที่เอกสารและเบอร์โทรศัพท์ที่ให้ไว้กับศูนย์บริการ</p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="no" className="mb-1 block text-xs font-medium">
            เลขที่งานซ่อม หรือ เลขที่ใบเสนอราคา
          </label>
          <input
            id="no"
            value={no}
            onChange={(e) => setNo(e.target.value)}
            placeholder="J2612165 หรือ Q2600468"
            autoComplete="off"
            className="num h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label htmlFor="p4" className="mb-1 block text-xs font-medium">
            เบอร์โทรศัพท์ 4 ตัวท้าย
          </label>
          <input
            id="p4"
            value={phone4}
            onChange={(e) => setPhone4(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="1234"
            inputMode="numeric"
            autoComplete="off"
            className="num h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {/* background re-check: empty unless Cloudflare asks for a click */}
        <div ref={formEl} className="flex justify-center empty:hidden" />

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={busy || verifying || !no.trim() || phone4.length !== 4}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy || verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {verifying ? "กำลังตรวจสอบความปลอดภัย…" : "ติดตามสถานะ"}
        </button>
        <p className="flex items-center justify-center gap-1.5 text-2xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-success" /> ยืนยันแล้ว · ป้องกันโดย Cloudflare
        </p>
      </form>

      <p className="mt-4 text-xs text-muted-foreground">
        เลขที่เอกสารอยู่บนใบรับงาน / ใบเสนอราคาที่ได้รับจากศูนย์บริการ · หากหาไม่พบ กรุณาติดต่อศูนย์บริการตามเบอร์ด้านล่าง
      </p>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="surface mx-auto max-w-md p-6 text-center text-sm text-muted-foreground">
      <ShieldCheck className="mx-auto mb-3 h-9 w-9 text-muted-foreground/60" />
      {text}
    </div>
  );
}
