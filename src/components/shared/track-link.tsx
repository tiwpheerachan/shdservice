"use client";

import * as React from "react";
import { Link2, Copy, Check, RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { api, postJson, errMsg } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

/**
 * "ลิงก์ติดตามสำหรับลูกค้า" — usable from the moment the job is opened: staff
 * copy it here and send it in LINE (there is no QR any more). Opening it shows
 * nothing until the customer passes Turnstile — see app/api/track/*. `ready` mirrors the server rule (see tracking.ts) so the box
 * never hands out a link that would answer "ไม่พบข้อมูล".
 */
export function TrackLink({ jobNo, compact }: { jobNo: string; compact?: boolean }) {
  const { push } = useToast();
  const confirm = useConfirm();
  const { edit: canEdit } = useAccess().forPath("/jobs/edit");
  const [url, setUrl] = React.useState("");
  const [ready, setReady] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    api<{ url: string; ready: boolean }>(`/api/jobs/${encodeURIComponent(jobNo)}/track-link`)
      .then((d) => {
        if (!active) return;
        setUrl(d.url);
        setReady(d.ready);
      })
      .catch(() => active && setUrl(""))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [jobNo]);

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
    const ok = await confirm({
      tone: "danger",
      title: "ออกลิงก์ติดตามใหม่?",
      description: "ลิงก์เดิมจะใช้ไม่ได้ทันที ใช้เมื่อส่งลิงก์ผิดคนเท่านั้น",
      confirmLabel: "ออกลิงก์ใหม่",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const d = await postJson<{ url: string }>(`/api/jobs/${encodeURIComponent(jobNo)}/track-link`, {});
      setUrl(d.url);
      push({ kind: "success", title: "ออกลิงก์ใหม่แล้ว", desc: "ลิงก์เดิมใช้ไม่ได้แล้ว" });
    } catch (e) {
      push({ kind: "error", title: "ออกลิงก์ใหม่ไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  if (loading || !url) return null;

  return (
    <div className={compact ? "rounded-lg border border-border p-3" : "surface p-4"}>
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">ลิงก์ติดตามสำหรับลูกค้า</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {ready
          ? "ส่งให้ลูกค้าทาง LINE ได้เลย — ลูกค้ากดยืนยันตัวตน (captcha) ก่อนแล้วจึงเห็นสถานะงาน ไม่เห็นราคา"
          : "ยังใช้ไม่ได้สำหรับงานนี้"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-2 text-xs">{url}</code>
        <Button variant="outline" size="sm" type="button" onClick={copy} disabled={!ready}>
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
        </Button>
        <Button variant="outline" size="sm" type="button" onClick={() => window.open(url, "_blank")} disabled={!ready}>
          <ExternalLink className="h-3.5 w-3.5" />
          ดูหน้าที่ลูกค้าเห็น
        </Button>
        {canEdit && (
          <Button variant="ghost" size="sm" type="button" onClick={rotate} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            ออกลิงก์ใหม่
          </Button>
        )}
      </div>
    </div>
  );
}
