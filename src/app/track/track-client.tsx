"use client";

import * as React from "react";
import Script from "next/script";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { TRACK_MSG, type PublicJob } from "@/lib/track-public";
import { PublicJobView } from "./public-job-view";

/**
 * Browser side of the tracking flow:
 *
 *   Turnstile → POST /api/track/session → { ticket } → POST /api/track/data → PublicJob
 *
 * The ticket lives only in a local variable for the few milliseconds between the
 * two calls — never in state, storage or a cookie. Refresh / come back later /
 * open another job = a new Turnstile. Nothing about the job is known before it.
 */
type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

type Props = { mode: "link"; linkToken: string; nonce?: string } | { mode: "form"; nonce?: string };

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

export function TrackClient(props: Props) {
  const widgetEl = React.useRef<HTMLDivElement>(null);
  const widgetId = React.useRef<string | null>(null);
  const [tsToken, setTsToken] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [job, setJob] = React.useState<PublicJob | null>(null);
  const [no, setNo] = React.useState("");
  const [phone4, setPhone4] = React.useState("");

  const resetCaptcha = React.useCallback(() => {
    setTsToken("");
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, []);

  // session → ticket → data, back to the captcha on any failure
  const run = React.useCallback(
    async (turnstileToken: string, fields: Record<string, string>) => {
      setBusy(true);
      setError("");
      try {
        const s = await post("/api/track/session", { ...fields, turnstileToken });
        if (!s.ok || !s.ticket) {
          setError(s.error ?? TRACK_MSG.sessionFail);
          resetCaptcha();
          return;
        }
        // the ticket exists only inside `s` for this one call — it is single-use, spent either way
        const d = await post("/api/track/data", { ticket: s.ticket });
        if (d.ok && d.job) {
          setJob(d.job);
          return;
        }
        setError(d.error ?? TRACK_MSG.ticketFail);
        resetCaptcha();
      } catch {
        setError("เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        resetCaptcha();
      } finally {
        setBusy(false);
      }
    },
    [resetCaptcha]
  );

  // link mode starts the moment the captcha passes; form mode waits for the button
  const linkToken = props.mode === "link" ? props.linkToken : "";
  const onToken = React.useRef<(t: string) => void>(() => {});
  onToken.current = (t: string) => {
    setTsToken(t);
    if (props.mode === "link") void run(t, { linkToken });
  };

  const renderWidget = React.useCallback(() => {
    if (!SITE_KEY || !window.turnstile || !widgetEl.current || widgetId.current) return;
    widgetId.current = window.turnstile.render(widgetEl.current, {
      sitekey: SITE_KEY,
      action: "track",
      language: "th",
      callback: (t: string) => onToken.current(t),
      "expired-callback": () => setTsToken(""),
      "error-callback": () => setError(TRACK_MSG.unavailable),
    });
  }, []);

  // the script may already be on the page (client-side navigation between /track pages)
  React.useEffect(() => {
    renderWidget();
    return () => {
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [renderWidget]);

  if (!SITE_KEY) {
    // no site key in this build → fail closed, never show data without a captcha
    return <Notice text={TRACK_MSG.unavailable} />;
  }

  if (job) {
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
              resetCaptcha();
            }}
            className="text-sm font-medium text-primary hover:underline"
          >
            ค้นหารายการอื่น
          </button>
        )}
      </div>
    );
  }

  const widget = (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        nonce={props.nonce}
        onReady={renderWidget}
      />
      <div ref={widgetEl} className="min-h-[65px]" />
    </>
  );

  if (props.mode === "link") {
    return (
      <div className="surface mx-auto max-w-md p-6 text-center">
        <ShieldCheck className="mx-auto mb-3 h-9 w-9 text-primary" />
        <h1 className="text-base font-semibold">ยืนยันก่อนดูสถานะงานซ่อม</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">เพื่อความปลอดภัยของข้อมูล กรุณายืนยันว่าคุณไม่ใช่โปรแกรมอัตโนมัติ</p>
        <div className="mt-4 flex justify-center">{widget}</div>
        {busy && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดข้อมูล…
          </p>
        )}
        {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="surface mx-auto max-w-md p-6">
      <h1 className="text-lg font-semibold tracking-tight">ติดตามสถานะงานซ่อม</h1>
      <p className="mt-1 text-sm text-muted-foreground">กรอกเลขที่เอกสารและเบอร์โทรศัพท์ที่ให้ไว้กับศูนย์บริการ</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (tsToken) void run(tsToken, { no: no.trim(), phone4: phone4.trim() });
        }}
        className="mt-5 space-y-4"
      >
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

        {widget}

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={busy || !tsToken || !no.trim() || phone4.length !== 4}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          ติดตามสถานะ
        </button>
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
