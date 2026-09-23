"use client";

import * as React from "react";
import Script from "next/script";
import { Search, Loader2 } from "lucide-react";

/**
 * Fallback lookup for a customer who has the quotation but lost the link:
 * job number OR quotation number + the last 4 digits of their phone.
 * On success the browser lands on the same /t/<token> page as the QR code.
 */
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export default function TrackFormPage() {
  const [no, setNo] = React.useState("");
  const [phone4, setPhone4] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [needChallenge, setNeedChallenge] = React.useState(false);
  const widget = React.useRef<HTMLDivElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const turnstileToken =
        needChallenge && typeof window !== "undefined"
          ? ((window as unknown as { turnstile?: { getResponse: (el?: HTMLElement) => string } }).turnstile?.getResponse(widget.current ?? undefined) ?? "")
          : "";
      const r = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ no: no.trim(), phone4: phone4.trim(), turnstileToken }),
      });
      const d = (await r.json()) as { ok?: boolean; url?: string; error?: string; challenge?: boolean };
      if (d.ok && d.url) {
        window.location.href = d.url;
        return;
      }
      setError(d.error ?? "ไม่พบข้อมูล");
      if (d.challenge && SITE_KEY) setNeedChallenge(true);
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="surface mx-auto max-w-md p-6">
      <h1 className="text-lg font-semibold tracking-tight">ติดตามสถานะงานซ่อม</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        กรอกเลขที่เอกสารและเบอร์โทรศัพท์ที่ให้ไว้กับศูนย์บริการ
      </p>

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

        {needChallenge && SITE_KEY && (
          <>
            <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
            <div ref={widget} className="cf-turnstile" data-sitekey={SITE_KEY} data-language="th" />
          </>
        )}

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={busy || !no.trim() || phone4.length !== 4}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          ติดตามสถานะ
        </button>
      </form>

      <p className="mt-4 text-xs text-muted-foreground">
        เลขที่เอกสารอยู่บนใบเสนอราคาที่ได้รับจากศูนย์บริการ · หากหาไม่พบ กรุณาติดต่อศูนย์บริการตามเบอร์ด้านล่าง
      </p>
    </div>
  );
}
