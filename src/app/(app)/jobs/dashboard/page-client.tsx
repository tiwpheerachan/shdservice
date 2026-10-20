'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, RotateCcw, TriangleAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { TableScroll } from '@/components/ui/data-table';
import { LookupError } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { jobTone, type Tone } from '@/components/ui/badge';
import { TAT_BUCKET_LABEL } from '@/data/options';
import { SearchSelect } from '@/components/shared/search-select';
import { useDashboard, useJobs, useJobStatuses, useJobTypes } from '@/data/db';
import { int, cn } from '@/lib/utils';
import { daysAgo, today } from '@/lib/dates';
import { useAccess } from '@/lib/use-access';

/* one restrained accent per status group — carried as a small dot + thin bar, never a fill */
const TONE: Record<string, string> = {
  pending: 'bg-warning',
  repaired: 'bg-info',
  finished: 'bg-success',
  cancel: 'bg-danger', // the Cancel badges' tone (jobTone)
  total: 'bg-primary',
};

/* a job status's dot / band — the same colour as its StatusBadge (jobTone) */
const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-muted-foreground/40',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** a panel's failed read — same look as DataTable's error row */
function LoadFailed({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div role="alert" className="px-5 py-10 text-center">
      <TriangleAlert className="mx-auto mb-2 h-7 w-7 text-destructive/70" aria-hidden />
      <p className="text-sm font-medium text-destructive">โหลดข้อมูลไม่สำเร็จ</p>
      <p className="mt-1 text-xs text-muted-foreground/80">{error}</p>
      <Button variant="outline" size="sm" type="button" className="mt-3" onClick={onRetry}>
        <RotateCcw className="h-3.5 w-3.5" />
        ลองใหม่
      </Button>
    </div>
  );
}

/** first load: placeholder rows that keep a table's height (each as tall as a data row: py-2.5 + a 20px line) */
const TAT_SKELETON_ROWS = 16;

function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return Array.from({ length: rows }, (_, i) => (
    <tr key={i} className="border-b border-border/60 last:border-0" aria-busy>
      {Array.from({ length: cols }, (_, j) => (
        <td key={j} className={cn('py-2.5', j === 0 ? 'pl-5 pr-3' : 'px-3')}>
          <Skeleton className={cn('my-[3px] h-3.5', j === 0 ? 'w-10' : i % 2 ? 'w-3/5' : 'w-4/5')} />
        </td>
      ))}
    </tr>
  ));
}

/* ---- section shell: flat card, hairline header ---- */
function Panel({
  title,
  meta,
  children,
  className,
  bodyClass,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-card', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {meta && <div className="text-2xs text-muted-foreground">{meta}</div>}
      </div>
      <div className={cn('p-5', bodyClass)}>{children}</div>
    </section>
  );
}

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
/* TAT deep links → job list. Buckets count days from the Thai calendar day (same as the server query),
   so each bucket is a create-date range: 1–3 = from today−3, 4–7 = today−7…today−4, …, >30 = up to today−31. */
type TatKey = 'd13' | 'd47' | 'd814' | 'd1530' | 'over30' | 'total';
const TAT_RANGE: Record<TatKey, [from: number | null, to: number | null]> = {
  d13: [3, null],
  d47: [7, 4],
  d814: [14, 8],
  d1530: [30, 15],
  over30: [null, 31],
  total: [null, null],
};
function tatHref(bucket: TatKey, type: string, status?: { id?: number; name: string }) {
  const [f, t] = TAT_RANGE[bucket];
  const p = new URLSearchParams({ src: 'tat', bucket, open: '1' });
  if (status?.id) {
    p.set('statusId', String(status.id));
    p.set('status', status.name);
  }
  if (f !== null) p.set('from', daysAgo(f));
  if (t !== null) p.set('to', daysAgo(t));
  if (type) p.set('type', type);
  return `/jobs/list?${p}`;
}
/** KPI card → the job list counting the same jobs: status group (the card's `sub` is the group name)
 *  + create-date range + job type, like computeDashboard's `createdIn` */
function kpiHref(g: { sub: string; label: string }, from: string, to: string, type: string) {
  const p = new URLSearchParams({ src: 'kpi', group: g.sub, label: g.label });
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (type) p.set('type', type);
  return `/jobs/list?${p}`;
}
/** a clickable TAT count — zero stays a quiet dash */
function TatNum({ n, href, className }: { n: number; href: string; className?: string }) {
  if (!n) return <span className="text-muted-foreground/30">–</span>;
  return (
    <Link
      href={href}
      className={cn(
        'rounded px-1 -mx-1 underline-offset-4 transition-colors hover:bg-accent hover:underline',
        className,
      )}
    >
      {int(n)}
    </Link>
  );
}
const thai = (iso: string) => {
  if (!iso) return '';
  const [y = NaN, m = NaN, d] = iso.split('-').map(Number);
  return `${d} ${TH_MONTH[m - 1]} ${String(y + 543).slice(-2)}`;
};

export default function DashboardPage() {
  const canAdd = useAccess().can('Job Management', 'add'); // เปิดงานใหม่ only for a role that may
  // date range (default: last 30 days) — every panel except TAT follows it; both empty = ทั้งหมด
  const [from, setFrom] = React.useState(() => daysAgo(29));
  const [to, setTo] = React.useState(() => today());
  // job type (name, same as the job list filter) — "" = every type; applies to every panel incl. TAT
  const [type, setType] = React.useState('');
  const { data: JOB_TYPES, ...jobTypesLookup } = useJobTypes();
  // a reversed pair finds nothing: say so (as FilterBar does) and keep showing the last range that made sense
  const reversed = !!from && !!to && from > to;
  const [range, setRange] = React.useState({ from, to, type });
  if (!reversed && (range.from !== from || range.to !== to || range.type !== type)) setRange({ from, to, type });
  // presets use the Thai calendar (lib/dates), like the server's date filters
  const preset = (key: '7d' | '30d' | '90d' | 'month' | 'all') => {
    const now = today();
    if (key === 'all') {
      setFrom('');
      setTo('');
      return;
    }
    if (key === 'month') {
      setFrom(`${now.slice(0, 8)}01`);
      setTo(now);
      return;
    }
    setFrom(daysAgo(key === '7d' ? 6 : key === '30d' ? 29 : 89));
    setTo(now);
  };
  const now = today();
  const activePreset =
    !from && !to
      ? 'all'
      : to === now && from === daysAgo(6)
        ? '7d'
        : to === now && from === daysAgo(29)
          ? '30d'
          : to === now && from === daysAgo(89)
            ? '90d'
            : to === now && from === `${now.slice(0, 8)}01`
              ? 'month'
              : '';

  // one request for every panel
  const { data: dashData, loading: dashLoading, error: dashError, refetch: retryDash } = useDashboard(range);
  const DASH = dashError ? null : dashData; // no stale range's numbers under an error
  const dashFirstLoad = dashLoading && !DASH;
  const { data: STATUSES } = useJobStatuses(); // status → group, for the TAT row colour
  const DASH_GROUPS = DASH?.groups ?? [];
  const TAT_ROWS = DASH?.tat ?? [];
  const MONTHLY = DASH?.monthly ?? [];
  const TOP_SYMPTOMS = DASH?.topSymptoms ?? [];
  const { data: JOBS, loading: jobsLoading, error: jobsError, refetch: retryJobs } = useJobs({ limit: 6, ...range }); // latest 6 in range for the "งานล่าสุด" list
  const granularity = DASH?.granularity ?? 'month';
  const rangeText =
    (!range.from && !range.to ? 'ทั้งหมด' : `${thai(range.from) || 'เริ่มต้น'} – ${thai(range.to) || 'วันนี้'}`) +
    (range.type ? ` · ${range.type}` : '');

  const maxSymptom = Math.max(1, ...TOP_SYMPTOMS.map((s) => s.count));

  const tat = TAT_ROWS.map((r) => ({
    ...r,
    total: r.d13 + r.d47 + r.d814 + r.d1530 + r.over30,
  }));
  const grand = tat.reduce(
    (a, r) => ({
      d13: a.d13 + r.d13,
      d47: a.d47 + r.d47,
      d814: a.d814 + r.d814,
      d1530: a.d1530 + r.d1530,
      over30: a.over30 + r.over30,
      total: a.total + r.total,
    }),
    { d13: 0, d47: 0, d814: 0, d1530: 0, over30: 0, total: 0 },
  );
  const dayCols = (Object.keys(TAT_BUCKET_LABEL) as (keyof typeof TAT_BUCKET_LABEL)[]).map((k) => ({
    k,
    label: TAT_BUCKET_LABEL[k],
  }));

  /* monthly line chart geometry */
  const W = 640,
    H = 190,
    padL = 8,
    padR = 8,
    padT = 14,
    padB = 8;
  const iw = W - padL - padR,
    ih = H - padT - padB;
  const maxM = Math.max(1, ...MONTHLY.flatMap((m) => [m.open, m.close]));
  const px = (i: number) => padL + (MONTHLY.length <= 1 ? iw / 2 : (i / (MONTHLY.length - 1)) * iw);
  const py = (v: number) => padT + ih - (v / maxM) * ih;
  const line = (key: 'open' | 'close') => MONTHLY.map((m, i) => `${px(i)},${py(m[key])}`).join(' ');
  const area = (key: 'open' | 'close') =>
    MONTHLY.length ? `${padL},${padT + ih} ${line(key)} ${padL + iw},${padT + ih}` : '';

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-2xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Service Operations</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">ภาพรวมงานบริการ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            การ์ดสรุปและกราฟ: งานที่เปิดในช่วง {rangeText} · ตาราง TAT: งานค้างทั้งหมด ณ ตอนนี้
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-[190px]">
            <SearchSelect
              value={type}
              onChange={setType}
              options={JOB_TYPES.map((j) => ({ value: j.name, label: j.name }))}
              placeholder="ทุกประเภทงาน"
              emptyLabel="ทุกประเภทงาน"
            />
            <LookupError error={jobTypesLookup.error} onRetry={jobTypesLookup.refetch} />
          </div>
          {/* date range: two inputs + presets that just fill them in (empty = ทั้งหมด) */}
          {/* a full-width row below sm: two 150px inputs overflowed a 320px screen (WCAG 1.4.10) */}
          <div className="flex w-full items-center gap-1.5 sm:w-auto">
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="num h-9 min-w-0 flex-1 sm:w-[150px] sm:flex-none"
              aria-label="วันที่เริ่ม"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="num h-9 min-w-0 flex-1 sm:w-[150px] sm:flex-none"
              aria-label="วันที่สิ้นสุด"
            />
          </div>
          {reversed && (
            <p role="alert" className="flex basis-full items-center gap-1.5 text-xs font-medium text-danger">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด
            </p>
          )}
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5 text-xs">
            {(
              [
                ['7d', '7 วัน'],
                ['30d', '30 วัน'],
                ['90d', '90 วัน'],
                ['month', 'เดือนนี้'],
                ['all', 'ทั้งหมด'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => preset(k)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 font-medium transition-colors',
                  activePreset === k ? 'bg-card text-primary shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {canAdd && (
            <Link
              href="/jobs/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              เปิดงานใหม่
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      {/* KPI band — hairline-separated cells, no gradient fills. Its scope said out loud: the TAT table
          below and the bell count every open job now, so the numbers differ on purpose */}
      <section className="space-y-2" aria-label="สรุปงานที่เปิดในช่วงวันที่เลือก">
        <p className="text-xs text-muted-foreground">งานที่เปิดในช่วงวันที่เลือก ({rangeText})</p>
        {dashError && (
          <div className="rounded-xl border border-border bg-card">
            <LoadFailed error={dashError} onRetry={retryDash} />
          </div>
        )}
        <div
          className={cn(
            'grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4',
            dashError && 'hidden',
          )}
        >
          {dashFirstLoad &&
            Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="space-y-3 bg-card p-5" aria-busy>
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-[3px] w-full" />
              </div>
            ))}
          {DASH_GROUPS.map((g) => (
            <Link
              key={g.key}
              href={kpiHref(g, range.from, range.to, range.type)}
              className="group bg-card p-5 transition-colors hover:bg-accent/40"
            >
              <div className="flex items-center gap-2">
                <span className={cn('h-1.5 w-1.5 rounded-full', TONE[g.key])} />
                <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">{g.label}</span>
              </div>
              <p className="num mt-3 text-[30px] font-semibold leading-none tracking-tight tabular-nums">
                {int(g.jobs)}
              </p>
              <div className="mt-3.5 flex items-center gap-2.5">
                <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn('block h-full rounded-full', TONE[g.key])}
                    style={{ width: `${Math.min(100, g.percent)}%` }}
                  />
                </span>
                <span className="num text-2xs tabular-nums text-muted-foreground">{g.percent.toFixed(2)}%</span>
              </div>
              <p className="mt-2 text-2xs text-muted-foreground">{g.sub}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* TAT matrix */}
      <Panel
        title="TAT — ระยะเวลาตั้งแต่วันเปิดงานถึงวันส่งคืน"
        meta={
          <span>
            งานค้างทั้งหมด ณ ตอนนี้ (ไม่ขึ้นกับช่วงวันที่) · จำแนกตามสถานะงานและช่วงจำนวนวัน{type ? ` · ${type}` : ''}
          </span>
        }
        bodyClass="p-0"
      >
        <TableScroll label="งานค้างตามสถานะและจำนวนวัน">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 py-2.5 pl-5 pr-3 text-left font-medium">#</th>
                <th className="py-2.5 pr-4 text-left font-medium">สถานะงาน</th>
                {dayCols.map((c) => (
                  <th key={c.k} className="px-4 py-2.5 text-right font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="py-2.5 pr-5 text-right font-medium">รวม</th>
              </tr>
            </thead>
            <tbody>
              {/* a FIXED height (the usual 15 open statuses + total): it must not wait for job_statuses — sizing
                  it from that second request makes the panel grow 7 → 19 → 16 rows (CLS 0.15) */}
              {dashFirstLoad && <SkeletonRows rows={TAT_SKELETON_ROWS} cols={8} />}
              {dashError && (
                <tr>
                  <td colSpan={8}>
                    <LoadFailed error={dashError} onRetry={retryDash} />
                  </td>
                </tr>
              )}
              {tat.map((r, i) => (
                <tr key={r.status} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                  <td className="py-2.5 pl-5 pr-3">
                    <span className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          'h-3.5 w-[3px] rounded-full',
                          TONE_BG[jobTone(r.status, STATUSES.find((s) => s.id === r.statusId)?.group)],
                        )}
                      />
                      <span className="num text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-medium">{r.status}</td>
                  {(['d13', 'd47', 'd814', 'd1530'] as const).map((k) => (
                    <td key={k} className="num px-4 py-2.5 text-right tabular-nums">
                      <TatNum n={r[k]} href={tatHref(k, type, { id: r.statusId, name: r.status })} />
                    </td>
                  ))}
                  <td className="num px-4 py-2.5 text-right tabular-nums">
                    <TatNum
                      n={r.over30}
                      href={tatHref('over30', type, { id: r.statusId, name: r.status })}
                      className={cn(r.over30 > 20 && 'font-semibold text-danger')}
                    />
                  </td>
                  <td className="num py-2.5 pr-5 text-right font-semibold tabular-nums">
                    <TatNum n={r.total} href={tatHref('total', type, { id: r.statusId, name: r.status })} />
                  </td>
                </tr>
              ))}
            </tbody>
            {tat.length > 0 && (
              <tfoot>
                <tr className="border-t border-border text-sm">
                  <td colSpan={2} className="py-2.5 pl-5 text-xs uppercase tracking-wide text-muted-foreground">
                    รวมทั้งสิ้น
                  </td>
                  {dayCols.map((c) => (
                    <td key={c.k} className="num px-4 py-2.5 text-right font-medium tabular-nums">
                      {grand[c.k] ? <TatNum n={grand[c.k]} href={tatHref(c.k, type)} /> : 0}
                    </td>
                  ))}
                  <td className="num py-2.5 pr-5 text-right font-semibold tabular-nums text-primary">
                    <TatNum n={grand.total} href={tatHref('total', type)} />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </TableScroll>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* monthly line chart */}
        <Panel
          title={granularity === 'day' ? 'แนวโน้มงานเปิด / ปิด รายวัน' : 'แนวโน้มงานเปิด / ปิด รายเดือน'}
          className="lg:col-span-2"
          meta={
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" />
                เปิดงาน
              </span>
              <span className="flex items-center gap-1.5">
                {/* dashed like its line: the two series differ by more than colour (WCAG 1.4.1) */}
                <span className="w-3.5 border-t-2 border-dashed border-success" />
                ปิดงาน
              </span>
            </div>
          }
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            style={{ height: 200 }}
            preserveAspectRatio="none"
            role="img"
            aria-label="แนวโน้มงานเปิด / ปิด — ตัวเลขอยู่ในตารางถัดไป"
          >
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <line
                key={f}
                x1={padL}
                x2={padL + iw}
                y1={padT + ih - f * ih}
                y2={padT + ih - f * ih}
                stroke="hsl(var(--border))"
                strokeWidth="1"
              />
            ))}
            {MONTHLY.length > 0 && (
              <>
                <polygon points={area('close')} fill="hsl(var(--success))" fillOpacity="0.08" />
                <polygon points={area('open')} fill="hsl(var(--primary))" fillOpacity="0.10" />
                <polyline
                  points={line('close')}
                  fill="none"
                  stroke="hsl(var(--success))"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points={line('open')}
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {MONTHLY.map((m, i) => (
                  <g key={m.m}>
                    <circle cx={px(i)} cy={py(m.open)} r="2.5" fill="hsl(var(--primary))" />
                    <circle cx={px(i)} cy={py(m.close)} r="2.5" fill="hsl(var(--success))" />
                  </g>
                ))}
              </>
            )}
          </svg>
          {/* the chart's numbers for screen readers (WCAG 1.1.1) */}
          <table className="sr-only">
            <caption>{granularity === 'day' ? 'จำนวนงานเปิด / ปิด รายวัน' : 'จำนวนงานเปิด / ปิด รายเดือน'}</caption>
            <thead>
              <tr>
                <th scope="col">{granularity === 'day' ? 'วัน' : 'เดือน'}</th>
                <th scope="col">เปิดงาน</th>
                <th scope="col">ปิดงาน</th>
              </tr>
            </thead>
            <tbody>
              {MONTHLY.map((m) => (
                <tr key={m.m}>
                  <th scope="row">{m.m}</th>
                  <td>{int(m.open)}</td>
                  <td>{int(m.close)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div aria-hidden className="mt-2 flex justify-between px-1 text-2xs text-muted-foreground">
            {MONTHLY.filter(
              (_, i, a) => a.length <= 14 || i % Math.ceil(a.length / 12) === 0 || i === a.length - 1,
            ).map((m) => (
              <span key={m.m}>{m.m}</span>
            ))}
          </div>
        </Panel>

        {/* top symptoms */}
        <Panel title="อาการเสียที่พบบ่อย" meta={<span>Top {TOP_SYMPTOMS.length}</span>}>
          <ol className="space-y-3.5">
            {TOP_SYMPTOMS.map((s, i) => (
              <li key={s.name}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate">
                    <span className="num mr-2 text-muted-foreground tabular-nums">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {s.name}
                  </span>
                  <span className="num shrink-0 font-medium tabular-nums">{int(s.count)}</span>
                </div>
                <span className="block h-[3px] overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary/70"
                    style={{ width: `${(s.count / maxSymptom) * 100}%` }}
                  />
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      {/* recent jobs */}
      <Panel
        title="งานล่าสุด"
        meta={
          <Link href="/jobs/list" className="font-medium text-primary hover:underline">
            ดูทั้งหมด →
          </Link>
        }
        bodyClass="p-0"
      >
        <TableScroll label="งานล่าสุด">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2.5 pl-5 text-left font-medium">เลขที่งาน</th>
                <th className="py-2.5 text-left font-medium">วันที่เปิดงาน</th>
                <th className="py-2.5 text-left font-medium">ลูกค้า</th>
                <th className="hidden py-2.5 text-left font-medium md:table-cell">ยี่ห้อ, รุ่น</th>
                <th className="hidden py-2.5 text-left font-medium lg:table-cell">ผู้รับผิดชอบ</th>
                <th className="py-2.5 pr-5 text-left font-medium">สถานะงาน</th>
              </tr>
            </thead>
            <tbody>
              {jobsLoading && JOBS.length === 0 && <SkeletonRows rows={6} cols={6} />}
              {jobsError && (
                <tr>
                  <td colSpan={6}>
                    <LoadFailed error={jobsError} onRetry={retryJobs} />
                  </td>
                </tr>
              )}
              {(jobsError ? [] : JOBS.slice(0, 6)).map((j) => (
                <tr key={j.no} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                  <td className="num py-2.5 pl-5 font-medium text-primary">{j.no}</td>
                  <td className="num py-2.5 text-xs text-muted-foreground">{j.openDate}</td>
                  <td className="max-w-[220px] truncate py-2.5 pr-3">{j.customer}</td>
                  <td className="hidden py-2.5 pr-3 md:table-cell">{j.brandModel}</td>
                  <td className="hidden py-2.5 pr-3 text-muted-foreground lg:table-cell">{j.owner}</td>
                  <td className="py-2.5 pr-5">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className={cn('h-1.5 w-1.5 rounded-full', TONE_BG[jobTone(j.status, j.statusGroup)])} />
                      {j.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Panel>
    </div>
  );
}
