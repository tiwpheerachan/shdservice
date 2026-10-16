'use client';

import * as React from 'react';
import { History, ChevronDown, ChevronUp } from 'lucide-react';
import { Section } from './section';
import { Badge, type Tone } from '@/components/ui/badge';
import type { JobDetail } from '@/lib/use-job';
import { fieldLabel } from '@/lib/field-labels';

const ACTION: Record<string, { label: string; tone: Tone }> = {
  CREATE: { label: 'เปิดงาน', tone: 'success' },
  UPDATE: { label: 'แก้ไข', tone: 'info' },
  DELETE: { label: 'ลบ', tone: 'danger' },
  STATUS: { label: 'สถานะ', tone: 'warning' },
  ASSIGN: { label: 'มอบหมาย', tone: 'info' },
  ISSUE: { label: 'จ่ายอะไหล่', tone: 'warning' },
  RETURN: { label: 'รับคืนอะไหล่', tone: 'success' },
  UPLOAD: { label: 'แนบไฟล์', tone: 'neutral' },
};

/** a value as people read it: empty / the legacy 1900-01-01 "no date" → —, yes/no in Thai, a date without its 00:00:00 */
const fmt = (v: unknown) =>
  v === null || v === undefined || v === '' || String(v).startsWith('1900-01-01')
    ? '—'
    : typeof v === 'boolean'
      ? v
        ? 'ใช่'
        : 'ไม่ใช่'
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v).replace(/^(\d{4}-\d{2}-\d{2}) 00:00:00$/, '$1'); // a date-only field stored as a timestamp

/**
 * ประวัติการแก้ไขของงาน — audit_log rows for this job (who / when / what changed),
 * shown to anyone allowed to open the job. Collapsed by default, latest first.
 */
export function JobHistorySection({ job }: { job: JobDetail | null }) {
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const rows = job?.history ?? [];
  if (!job) return null;
  return (
    <Section
      title="ประวัติการแก้ไข"
      icon={History}
      actions={
        <button
          type="button"
          data-readonly-keep
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {rows.length} รายการ {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      }
    >
      {!open ? (
        <p className="text-xs text-muted-foreground">
          {rows[0]
            ? `ล่าสุด: ${rows[0].at} · ${rows[0].user || '—'} · ${rows[0].summary}`
            : 'ยังไม่มีประวัติ (เริ่มบันทึกตั้งแต่เปิดใช้ audit log)'}
        </p>
      ) : (
        <ol className="divide-y divide-border/70 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-xs text-muted-foreground">{r.at}</span>
                <Badge tone={ACTION[r.action]?.tone ?? 'neutral'}>{ACTION[r.action]?.label ?? r.action}</Badge>
                <span className="font-medium">{r.user || '—'}</span>
                <span className="text-muted-foreground">{r.summary}</span>
                {r.changes && (
                  <button
                    type="button"
                    data-readonly-keep
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    className="ml-auto text-xs text-primary hover:underline"
                  >
                    {expanded === r.id ? 'ซ่อน' : `ดู ${Object.keys(r.changes).length} ฟิลด์`}
                  </button>
                )}
              </div>
              {expanded === r.id && r.changes && (
                <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-2">
                  {Object.entries(r.changes).map(([k, [a, b]]) => (
                    <div key={k} className="flex flex-wrap gap-1">
                      <dt className="font-medium">{fieldLabel(k)}:</dt>
                      <dd className="text-muted-foreground line-through">{fmt(a)}</dd>
                      <dd>→ {fmt(b)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
          {rows.length === 0 && <li className="py-2 text-xs text-muted-foreground">ยังไม่มีประวัติ</li>}
        </ol>
      )}
    </Section>
  );
}
