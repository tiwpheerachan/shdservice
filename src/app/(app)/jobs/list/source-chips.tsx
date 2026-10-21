'use client';

import { X } from 'lucide-react';
import type { Staff } from '@/data/db';
import { TAT_BUCKET, type Filters, type TatSource } from './use-job-list-url';

/** where the list came from — the bell's overdue link or a dashboard TAT / KPI card — as a clearable chip */
export function SourceChips({
  filters,
  tat,
  kpi,
  staff: STAFF,
  loading,
  total,
  onClear: clearAll,
}: {
  filters: Filters;
  tat: TatSource | null;
  kpi: string | null;
  staff: Staff[];
  loading: boolean;
  total: number;
  onClear: () => void;
}) {
  return (
    <>
      {filters.overdue && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-2 rounded-full border border-danger/30 bg-danger-soft py-1 pl-3 pr-1 text-danger">
            <span>
              จากการแจ้งเตือน: <span className="font-medium">งานเกินกำหนดส่ง</span>
              {filters.engineer &&
                ` · ช่าง ${STAFF.find((s) => String(s.id) === filters.engineer)?.name ?? `#${filters.engineer}`}`}
              <span className="num tabular-nums"> ({loading ? '…' : total.toLocaleString('en-US')} งาน)</span>
            </span>
            <button
              type="button"
              onClick={clearAll}
              title="ล้างตัวกรองงานเกินกำหนดส่ง"
              aria-label="ล้างตัวกรองงานเกินกำหนดส่ง"
              className="grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-danger hover:text-white dark:hover:text-background"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      )}
      {(tat || kpi) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-soft py-1 pl-3 pr-1 text-primary">
            <span>
              {tat ? (
                <>
                  จาก Dashboard TAT: <span className="font-medium">{tat.status || 'ทุกสถานะ'}</span>
                  {' · '}
                  {TAT_BUCKET[tat.bucket] ?? tat.bucket}
                  {tat.type && ` · ${tat.type}`}
                  {' · '}งานที่ยังไม่ปิด
                </>
              ) : (
                <>
                  จาก Dashboard: <span className="font-medium">{kpi}</span>
                  {' · '}เปิดงาน{' '}
                  {filters.from || filters.to ? `${filters.from || '…'} – ${filters.to || '…'}` : 'ทุกช่วงวัน'}
                  {filters.type && ` · ${filters.type}`}
                </>
              )}
              <span className="num tabular-nums"> ({loading ? '…' : total.toLocaleString('en-US')} งาน)</span>
            </span>
            <button
              type="button"
              onClick={clearAll}
              title="ล้างตัวกรองจาก Dashboard"
              aria-label="ล้างตัวกรองจาก Dashboard"
              className="grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      )}
    </>
  );
}
