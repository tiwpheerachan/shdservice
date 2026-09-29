"use client";

import * as React from "react";
import Script from "next/script";
import { Clock, Loader2, Search, ShieldCheck, Timer } from "lucide-react";
import { LINK_RULE_TEXT, TRACK_MSG, type PublicJob } from "@/lib/track-public";
import { PublicJobView } from "./public-job-view";
import { TrackOtp } from "./track-otp";

/**
 * Browser side of customer tracking. Both entry points start behind the same gate:
 *
 *   gate (Cloudflare checkbox, widget mode Managed) — nothing else on the page until it passes
 *
 *   link  /track/<token>: token → POST /api/track/session → { ticket } → POST /api/track/data → PublicJob
 *   form  /track:         phone → SMS OTP → the customer's jobs (TrackOtp, /api/track/otp/*, /api/track/me*)
 *
 * Every Turnstile token is single-use (Siteverify burns it). The gate's token pays for the
 * first captcha-protected call if it is still fresh; later ones come from a background,
 * execute-only widget (`interaction-only`: a checkbox only if Cloudflare asks for a click).
 * Tickets and the customer session live only in memory — refresh / come back = the gate again.
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

type Props =
  | { mode: "link"; linkToken: string; nonce?: string }
  | { mode: "form"; nonce?: string; otpAvailable: boolean; devOtpLog: boolean };
type Phase = "gate" | "ready" | "done" | "expired";

async function post(path: string, body: Record<string, string>) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
  });
  return (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; reason?: string; ticket?: string; job?: PublicJob; expiresAt?: string; url?: string };
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
  const [verifying, setVerifying] = React.useState(false);
  const [error, setError] = React.useState("");
  const [job, setJob] = React.useState<PublicJob | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = React.useState(0);

  const gateEl = React.useRef<HTMLDivElement>(null);
  const bgEl = React.useRef<HTMLDivElement>(null);
  /** the gate's token, kept for the first protected call only */
  const gateToken = React.useRef<{ t: string; at: number } | null>(null);
  /** a caller waiting for a background token */
  const waiter = React.useRef<((t: string | null) => void) | null>(null);

  // the script may already be loaded (client-side navigation between /track pages)
  React.useEffect(() => {
    if (window.turnstile) setTsReady(true);
  }, []);

  /* ---------- link mode: session → ticket → data ---------- */
  const linkToken = props.mode === "link" ? props.linkToken : "";
  const runLink = React.useCallback(async (turnstileToken: string) => {
    setError("");
    try {
      const s = await post("/api/track/session", { linkToken, turnstileToken });
      // the link itself is expired / used up → hint + the lookup page, not the captcha again
      if (s.reason === "link") {
        setPhase("expired");
        return;
      }
      if (!s.ok || !s.ticket) throw new Error(s.error ?? TRACK_MSG.sessionFail);
      if (s.expiresAt) setLinkExpiresAt(Date.parse(s.expiresAt));
      // the ticket exists only inside `s` for this one call — it is single-use, spent either way
      const d = await post("/api/track/data", { ticket: s.ticket });
      if (!d.ok || !d.job) throw new Error(d.error ?? TRACK_MSG.ticketFail);
      setJob(d.job);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      setPhase("gate");
    }
  }, [linkToken]);

  // latest-callback ref: refreshed after every commit (never written during render), read only
  // by the Turnstile callback below — which the widget keeps from its first render
  const onGatePass = React.useRef<(t: string) => void>(() => {});
  React.useLayoutEffect(() => {
    onGatePass.current = (t: string) => {
      setError("");
      setPhase("ready");
      if (props.mode === "link") void runLink(t);
      else gateToken.current = { t, at: Date.now() };
    };
  });

  // 1. the gate: a visible checkbox — nothing else on the page until it passes
  useTurnstile(gateEl, phase === "gate", tsReady, () => ({
    appearance: "always",
    callback: (t: string) => onGatePass.current(t),
    "error-callback": () => setError(TRACK_MSG.unavailable),
  }));

  // 2. form mode, after the gate: a background widget that runs only when asked (execute)
  const bgWidget = useTurnstile(bgEl, props.mode === "form" && phase === "ready", tsReady, () => ({
    appearance: "interaction-only",
    execution: "execute",
    callback: (t: string) => {
      setVerifying(false);
      waiter.current?.(t);
      waiter.current = null;
    },
    "error-callback": () => {
      setVerifying(false);
      waiter.current?.(null);
      waiter.current = null;
    },
  }));

  /** a fresh single-use token: the gate's while < 4 min old, otherwise a background check */
  const getToken = React.useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        const g = gateToken.current;
        gateToken.current = null;
        if (g && Date.now() - g.at < TOKEN_FRESH_MS) return resolve(g.t);
        if (!window.turnstile || !bgWidget.current) return resolve(null);
        waiter.current?.(null);
        waiter.current = resolve;
        setVerifying(true);
        window.turnstile.reset(bgWidget.current);
        window.turnstile.execute(bgWidget.current);
      }),
    [bgWidget]
  );

  if (!SITE_KEY) {
    // no site key in this build → fail closed, never show anything without the check
    return <Notice text={TRACK_MSG.unavailable} />;
  }
  if (props.mode === "form" && !props.otpAvailable) {
    return <Notice text={TRACK_MSG.otpUnavailable} />;
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

  /* ---------- link expired / used up ---------- */
  if (phase === "expired") {
    return (
      <div className="surface mx-auto max-w-md p-6 text-center">
        <Clock className="mx-auto mb-3 h-9 w-9 text-warning" />
        <h1 className="text-base font-semibold">{TRACK_MSG.linkExpired}</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
          {LINK_RULE_TEXT} — ขอลิงก์ใหม่จากศูนย์บริการ หรือตรวจสอบด้วยเบอร์มือถือ (รับรหัส OTP ทาง SMS)
        </p>
        {/* a full page load on purpose: fresh CSP nonce and a clean gate — nothing of the expired link stays in memory */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/track"
          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Search className="h-4 w-4" /> ตรวจสอบด้วยเบอร์มือถือ
        </a>
      </div>
    );
  }

  /* ---------- link: result / loading ---------- */
  if (props.mode === "link") {
    if (phase === "done" && job)
      return (
        <LinkResult
          job={job}
          linkToken={linkToken}
          expiresAt={linkExpiresAt}
          onExpiresAt={setLinkExpiresAt}
          onExpired={() => {
            setJob(null);
            setPhase("expired");
          }}
        />
      );
    return (
      <div className="surface mx-auto max-w-md p-6 text-center">
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดข้อมูล…
        </p>
      </div>
    );
  }

  /* ---------- form: phone + OTP ---------- */
  return (
    <div className="space-y-3">
      {script}
      <TrackOtp getToken={getToken} verifying={verifying} devOtpLog={props.devOtpLog} />
      {/* background re-check: empty unless Cloudflare asks for a click */}
      <div ref={bgEl} className="flex justify-center empty:hidden" />
    </div>
  );
}

/**
 * The job shown from a link, with the link's countdown. While the customer is using the page
 * (input in the last minute) and < 5.5 min are left, the keepalive keeps ≥ 5 min on the clock
 * (server cap: 60 min from the first open). At zero the data is taken off the screen.
 */
const ACTIVE_WINDOW_MS = 60_000;
const KEEPALIVE_WHEN_LEFT_MS = 5.5 * 60_000;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)} ชม. ${Math.floor((s % 3600) / 60)} นาที` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function LinkResult({
  job,
  linkToken,
  expiresAt,
  onExpiresAt,
  onExpired,
}: {
  job: PublicJob;
  linkToken: string;
  expiresAt: number;
  onExpiresAt: (ms: number) => void;
  onExpired: () => void;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const lastInput = React.useRef(0); // stamped on mount below (no Date.now() during render)
  const lastKeepalive = React.useRef(0);

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
    if (!expiresAt) return;
    if (now >= expiresAt) {
      onExpired();
      return;
    }
    const inUse = now - lastInput.current < ACTIVE_WINDOW_MS;
    if (inUse && expiresAt - now < KEEPALIVE_WHEN_LEFT_MS && now - lastKeepalive.current > 30_000) {
      lastKeepalive.current = now;
      void post("/api/track/link/keepalive", { linkToken }).then((d) => {
        if (d.reason === "link") onExpired();
        else if (d.expiresAt) onExpiresAt(Date.parse(d.expiresAt));
      });
    }
  }, [now, expiresAt, linkToken, onExpired, onExpiresAt]);

  // documents: the link itself authorises them (the server ignores any job no from here)
  const openDoc = React.useCallback(
    async (d: { kind: string; ref: string }) => {
      const r = await post("/api/track/doc", { linkToken, kind: d.kind, ref: d.ref });
      if (r.reason === "link") onExpired();
      return { url: r.ok ? r.url : undefined, error: r.error };
    },
    [linkToken, onExpired]
  );

  return (
    <div className="space-y-3">
      {expiresAt > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Timer className="h-3.5 w-3.5" /> ลิงก์นี้เหลือเวลา <span className="num font-medium text-foreground">{mmss(expiresAt - now)}</span>
          <span className="hidden sm:inline">· ต่อเวลาอัตโนมัติเมื่อใช้งานอยู่ (สูงสุด 60 นาที)</span>
        </p>
      )}
      <PublicJobView j={job} onOpenDoc={openDoc} />
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
