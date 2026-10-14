'use client';

import * as React from 'react';
import { Link2, Copy, Check, RefreshCw, ExternalLink, Loader2, Clock, Eye, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { postJson, errMsg } from '@/lib/api';
import { useApi } from '@/data/db';
import { useAccess } from '@/lib/use-access';
import { LINK_RULE_TEXT } from '@/lib/track-public';
import { cn } from '@/lib/utils';

/**
 * "ลิงก์ติดตามสำหรับลูกค้า" — staff copy it here and send it in LINE (there is no QR any
 * more). Opening it shows nothing until the customer passes Turnstile — see app/api/track/*.
 *
 * Lifetime (services/tracking.ts, drizzle/0016): 1 day from issue while unopened, then
 * 15 minutes from the customer's first open. The hint below the link says which state it
 * is in; an expired link cannot be copied — issue a new one. "ดูหน้าที่ลูกค้าเห็น" by a
 * signed-in staff member does not count as the customer's open.
 *
 * Only the link's hash is stored (drizzle/0025): the server returns a link once — when it
 * issues the job's first one, or on "สร้างลิงก์ใหม่" — and it stays copyable only while this
 * page is open. After that the box says so and offers a new link instead.
 */
type LinkStatus = {
  state: 'unopened' | 'opened' | 'expired';
  issuedAt: string | null;
  openedAt: string | null;
  expiresAt: string | null;
};
type LinkResponse = { url: string; ready?: boolean; status: LinkStatus };

/** characters of the link that always stay visible at its end (the token's tail) */
const URL_TAIL = 8;

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

function left(ms: number) {
  if (ms <= 0) return '';
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `อีก ${m} นาที`;
  const h = Math.floor(m / 60);
  return `อีก ${h} ชม.${m % 60 ? ` ${m % 60} นาที` : ''}`;
}

export function TrackLink({ jobNo, compact }: { jobNo: string; compact?: boolean }) {
  const { push } = useToast();
  const confirm = useConfirm();
  const { edit: canEdit } = useAccess().forPath('/jobs/edit');
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  // the link the server just returned (it is never sent again), and which issue it belongs to
  const [fresh, setFresh] = React.useState<{ url: string; issuedAt: string | null } | null>(null);

  // the link + its state through swr; re-read every minute (the customer may open it meanwhile)
  const link = useApi<LinkResponse>(`/api/jobs/${encodeURIComponent(jobNo)}/track-link`, {
    fresh: true,
    refreshInterval: 60_000,
  });
  const ready = link.data?.ready ?? true;
  const status = link.data?.status ?? null;
  // keep it past the next refresh (which no longer carries it) — adjusting state while rendering
  if (link.data?.url && link.data.url !== fresh?.url)
    setFresh({ url: link.data.url, issuedAt: link.data.status.issuedAt });
  // someone issued another link since → this one is dead, don't offer it
  const url = !link.error && fresh && fresh.issuedAt === status?.issuedAt ? fresh.url : '';

  // keep the countdown honest between reads
  React.useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const expiresMs = status?.expiresAt ? Date.parse(status.expiresAt) - now : 0;
  const state: LinkStatus['state'] = !status || status.state === 'expired' || expiresMs <= 0 ? 'expired' : status.state;
  const usable = ready && state !== 'expired' && !!url;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      push({ kind: 'error', title: 'คัดลอกไม่สำเร็จ', desc: 'กรุณาคัดลอกลิงก์ด้วยตัวเอง' });
    }
  };

  const rotate = async () => {
    // an expired link is already dead — only a live one needs the warning
    if (state !== 'expired') {
      const ok = await confirm({
        tone: 'danger',
        title: 'สร้างลิงก์ติดตามใหม่?',
        description: 'ลิงก์เดิมจะใช้ไม่ได้ทันที — ถ้าส่งลิงก์เดิมให้ลูกค้าไปแล้ว ต้องส่งลิงก์ใหม่นี้แทน',
        confirmLabel: 'สร้างลิงก์ใหม่',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const d = await postJson<LinkResponse>(`/api/jobs/${encodeURIComponent(jobNo)}/track-link`, {});
      void link.mutate({ ...d, ready: d.ready ?? ready }, { revalidate: false }); // show the new link at once
      setNow(Date.now());
      push({
        kind: 'success',
        title: 'สร้างลิงก์ใหม่แล้ว',
        desc: 'คัดลอกส่งลูกค้าได้เลย (แสดงจนกว่าจะออกจากหน้านี้) · ใช้ได้ 1 วัน · ลิงก์เดิมใช้ไม่ได้แล้ว',
      });
    } catch (e) {
      push({ kind: 'error', title: 'สร้างลิงก์ใหม่ไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  if (link.loading || link.error || !link.data) return null;

  const hint = !ready ? (
    <span>ยังใช้ไม่ได้สำหรับงานนี้</span>
  ) : state === 'expired' ? (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-medium text-danger">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {status?.openedAt
        ? `ลิงก์หมดอายุแล้ว (ลูกค้าเปิดดูเมื่อ ${fmt(status.openedAt)})`
        : 'ลิงก์หมดอายุแล้ว (ไม่มีการเปิดใช้ภายใน 1 วัน)'}
      {' — '}
      {canEdit ? 'กด “สร้างลิงก์ใหม่” ก่อนส่งให้ลูกค้า' : 'แจ้งผู้มีสิทธิ์แก้ไขงานเพื่อสร้างลิงก์ใหม่'}
    </span>
  ) : state === 'opened' ? (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-medium text-info">
      <Eye className="h-3.5 w-3.5 shrink-0" />
      ลูกค้าเปิดดูแล้วเมื่อ {fmt(status?.openedAt ?? null)} · หมดอายุ {fmt(status?.expiresAt ?? null)} (
      {left(expiresMs)})
    </span>
  ) : (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-medium text-warning">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      ยังไม่มีการเปิดใช้ · หมดอายุ {fmt(status?.expiresAt ?? null)} ({left(expiresMs)})
    </span>
  );

  return (
    <div className={compact ? 'rounded-lg border border-border p-3' : 'surface p-4'}>
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">ลิงก์ติดตามสำหรับลูกค้า</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        ส่งให้ลูกค้าทาง LINE — ลูกค้ากดยืนยันตัวตน (captcha) ก่อนแล้วจึงเห็นสถานะงาน ไม่เห็นราคา · {LINK_RULE_TEXT}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* middle ellipsis: the start shrinks with "…", the token's last characters always show —
            enough to tell two links apart; the full link is in the tooltip and is what gets copied */}
        {url ? (
          <>
            <code
              title={url}
              translate="no"
              className={cn(
                'flex min-w-0 flex-1 basis-60 rounded-md bg-muted px-2.5 py-2 text-xs',
                !usable && 'text-muted-foreground line-through',
              )}
            >
              <span className="truncate">{url.slice(0, -URL_TAIL)}</span>
              <span className="shrink-0">{url.slice(-URL_TAIL)}</span>
            </code>
            <Button variant="outline" size="sm" type="button" onClick={copy} disabled={!usable}>
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => window.open(url, '_blank')}
              disabled={!usable}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              ดูหน้าที่ลูกค้าเห็น
            </Button>
          </>
        ) : (
          <p className="min-w-0 flex-1 basis-60 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            ระบบไม่เก็บลิงก์ไว้ (เพื่อความปลอดภัย) จึงแสดงลิงก์ที่ออกไปแล้วซ้ำไม่ได้ —{' '}
            {canEdit
              ? 'กด “สร้างลิงก์ใหม่” เพื่อรับลิงก์ที่คัดลอกส่งลูกค้าได้ (ลิงก์เดิมจะใช้ไม่ได้ทันที)'
              : 'แจ้งผู้มีสิทธิ์แก้ไขงานเพื่อสร้างลิงก์ใหม่'}
          </p>
        )}
        {canEdit && (
          <Button
            variant={state === 'expired' || !url ? 'primary' : 'ghost'}
            size="sm"
            type="button"
            onClick={rotate}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            สร้างลิงก์ใหม่
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs">{hint}</p>
    </div>
  );
}
