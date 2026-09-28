"use client";

import * as React from "react";
import { Link2, Copy, Check, RefreshCw, ExternalLink, Loader2, Clock, Eye, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { api, postJson, errMsg } from "@/lib/api";
import { useAccess } from "@/lib/use-access";
import { LINK_RULE_TEXT } from "@/lib/track-public";
import { cn } from "@/lib/utils";

/**
 * "ลิงก์ติดตามสำหรับลูกค้า" — staff copy it here and send it in LINE (there is no QR any
 * more). Opening it shows nothing until the customer passes Turnstile — see app/api/track/*.
 *
 * Lifetime (services/tracking.ts, drizzle/0016): 1 day from issue while unopened, then
 * 15 minutes from the customer's first open. The hint below the link says which state it
 * is in; an expired link cannot be copied — issue a new one. "ดูหน้าที่ลูกค้าเห็น" by a
 * signed-in staff member does not count as the customer's open.
 */
type LinkStatus = {
  state: "unopened" | "opened" | "expired";
  issuedAt: string | null;
  openedAt: string | null;
  expiresAt: string | null;
};
type LinkResponse = { url: string; ready?: boolean; status: LinkStatus };

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function left(ms: number) {
  if (ms <= 0) return "";
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `อีก ${m} นาที`;
  const h = Math.floor(m / 60);
  return `อีก ${h} ชม.${m % 60 ? ` ${m % 60} นาที` : ""}`;
}

export function TrackLink({ jobNo, compact }: { jobNo: string; compact?: boolean }) {
  const { push } = useToast();
  const confirm = useConfirm();
  const { edit: canEdit } = useAccess().forPath("/jobs/edit");
  const [url, setUrl] = React.useState("");
  const [ready, setReady] = React.useState(false);
  const [status, setStatus] = React.useState<LinkStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  const load = React.useCallback(async () => {
    const d = await api<LinkResponse>(`/api/jobs/${encodeURIComponent(jobNo)}/track-link`);
    setUrl(d.url);
    setReady(d.ready ?? true);
    setStatus(d.status);
  }, [jobNo]);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .catch(() => active && setUrl(""))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [load]);

  // keep the countdown honest; re-read the state every minute (the customer may open it meanwhile)
  React.useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const poll = setInterval(() => void load().catch(() => {}), 60_000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [load]);

  const expiresMs = status?.expiresAt ? Date.parse(status.expiresAt) - now : 0;
  const state: LinkStatus["state"] = !status || status.state === "expired" || expiresMs <= 0 ? "expired" : status.state;
  const usable = ready && state !== "expired";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      push({ kind: "error", title: "คัดลอกไม่สำเร็จ", desc: "กรุณาคัดลอกลิงก์ด้วยตัวเอง" });
    }
  };

  const rotate = async () => {
    // an expired link is already dead — only a live one needs the warning
    if (state !== "expired") {
      const ok = await confirm({
        tone: "danger",
        title: "ออกลิงก์ติดตามใหม่?",
        description: "ลิงก์เดิมจะใช้ไม่ได้ทันที ใช้เมื่อส่งลิงก์ผิดคน หรือลูกค้าต้องการลิงก์ใหม่",
        confirmLabel: "ออกลิงก์ใหม่",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const d = await postJson<LinkResponse>(`/api/jobs/${encodeURIComponent(jobNo)}/track-link`, {});
      setUrl(d.url);
      setStatus(d.status);
      setNow(Date.now());
      push({ kind: "success", title: "ออกลิงก์ใหม่แล้ว", desc: "ใช้ได้ 1 วัน · ลิงก์เดิมใช้ไม่ได้แล้ว" });
    } catch (e) {
      push({ kind: "error", title: "ออกลิงก์ใหม่ไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  if (loading || !url) return null;

  const hint = !ready ? (
    <span>ยังใช้ไม่ได้สำหรับงานนี้</span>
  ) : state === "expired" ? (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-medium text-danger">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {status?.openedAt ? `ลิงก์หมดอายุแล้ว (ลูกค้าเปิดดูเมื่อ ${fmt(status.openedAt)})` : "ลิงก์หมดอายุแล้ว (ไม่มีการเปิดใช้ภายใน 1 วัน)"}
      {" — "}
      {canEdit ? "กด “ออกลิงก์ใหม่” ก่อนส่งให้ลูกค้า" : "แจ้งผู้มีสิทธิ์แก้ไขงานเพื่อออกลิงก์ใหม่"}
    </span>
  ) : state === "opened" ? (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-medium text-info">
      <Eye className="h-3.5 w-3.5 shrink-0" />
      ลูกค้าเปิดดูแล้วเมื่อ {fmt(status?.openedAt ?? null)} · หมดอายุ {fmt(status?.expiresAt ?? null)} ({left(expiresMs)})
    </span>
  ) : (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-medium text-warning">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      ยังไม่มีการเปิดใช้ · หมดอายุ {fmt(status?.expiresAt ?? null)} ({left(expiresMs)})
    </span>
  );

  return (
    <div className={compact ? "rounded-lg border border-border p-3" : "surface p-4"}>
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">ลิงก์ติดตามสำหรับลูกค้า</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        ส่งให้ลูกค้าทาง LINE — ลูกค้ากดยืนยันตัวตน (captcha) ก่อนแล้วจึงเห็นสถานะงาน ไม่เห็นราคา · {LINK_RULE_TEXT}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className={cn("min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-2 text-xs", !usable && "text-muted-foreground line-through")}>
          {url}
        </code>
        <Button variant="outline" size="sm" type="button" onClick={copy} disabled={!usable}>
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
        </Button>
        <Button variant="outline" size="sm" type="button" onClick={() => window.open(url, "_blank")} disabled={!usable}>
          <ExternalLink className="h-3.5 w-3.5" />
          ดูหน้าที่ลูกค้าเห็น
        </Button>
        {canEdit && (
          <Button variant={state === "expired" ? "primary" : "ghost"} size="sm" type="button" onClick={rotate} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            ออกลิงก์ใหม่
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs">{hint}</p>
    </div>
  );
}
