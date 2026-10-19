'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { TRACK_STEPS, type PublicJobSummary } from '@/lib/track-public';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { NO_FILTERS, type Filters, type Tab } from './use-track-session';

/** job list rows per page (each tab keeps its own page, also across opening a job and coming back) */
const PAGE_SIZE = 5;

/** the status the row shows ("รออะไหล่", "พร้อมให้มารับที่ศูนย์") — not its merged timeline step */
const statusKey = (r: PublicJobSummary) => (r.cancelled ? 'ยกเลิกรายการ' : r.stepLabel);
function matches(r: PublicJobSummary, f: Filters) {
  const q = f.q.trim().toLowerCase();
  if (q && ![r.no, r.brandModel, r.deviceRef.replace(/•/g, '')].some((v) => v.toLowerCase().includes(q))) return false;
  if (f.status && statusKey(r) !== f.status) return false;
  // YYYY-MM-DD strings compare as dates
  if (f.from && (!r.receivedDate || r.receivedDate < f.from)) return false;
  if (f.to && (!r.receivedDate || r.receivedDate > f.to)) return false;
  return true;
}

/** the customer's jobs: กำลังดำเนินการ / ประวัติ tabs, filters, rows (open one → onOpen), pages */
export function JobList({
  tab,
  setTab,
  pages,
  setPages,
  filters,
  setFilters,
  lists,
  busy,
  onOpen,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  pages: Record<Tab, number>;
  setPages: React.Dispatch<React.SetStateAction<Record<Tab, number>>>;
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  lists: { active: PublicJobSummary[]; history: PublicJobSummary[] };
  busy: boolean;
  onOpen: (no: string) => void;
}) {
  const tabRows = tab === 'active' ? lists.active : lists.history;
  // a reversed range finds nothing: say so and leave the dates out until it is fixed
  const reversed = !!filters.from && !!filters.to && filters.from > filters.to;
  const applied = reversed ? { ...filters, from: '', to: '' } : filters;
  const all = tabRows.filter((r) => matches(r, applied));
  const filtered = Object.values(filters).some((v) => v.trim() !== '');
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(pages[tab], totalPages);
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const goPage = (n: number) => setPages((p) => ({ ...p, [tab]: Math.min(totalPages, Math.max(1, n)) }));
  return (
    <div className="surface overflow-hidden">
      <div className="flex border-b border-border">
        {(
          [
            ['active', 'กำลังดำเนินการ', lists.active.length],
            ['history', 'ประวัติ', lists.history.length],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setTab(k);
              setFilters((f) => ({ ...f, status: '' })); // statuses differ per tab
            }}
            className={cn(
              'flex-1 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              tab === k
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label} <span className="num">({filtered ? lists[k].filter((r) => matches(r, applied)).length : n})</span>
          </button>
        ))}
      </div>
      {tabRows.length > 0 && (
        <ListFilters
          tabRows={tabRows}
          found={all.length}
          filters={filters}
          setFilters={setFilters}
          setPages={setPages}
          reversed={reversed}
          filtered={filtered}
        />
      )}
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          {tabRows.length > 0
            ? 'ไม่พบรายการที่ตรงกับตัวกรอง'
            : tab === 'active'
              ? 'ไม่มีงานที่กำลังดำเนินการ'
              : 'ไม่มีประวัติงานในช่วง 2 ปีที่ผ่านมา'}
        </p>
      ) : (
        <JobRows rows={rows} tab={tab} busy={busy} onOpen={onOpen} />
      )}
      {all.length > PAGE_SIZE && <Pager page={page} totalPages={totalPages} count={all.length} goPage={goPage} />}
    </div>
  );
}

/** search / status / received-date range over the current tab — a change goes back to page 1 */
function ListFilters({
  tabRows,
  found,
  filters,
  setFilters,
  setPages,
  reversed,
  filtered,
}: {
  tabRows: PublicJobSummary[];
  found: number;
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  setPages: React.Dispatch<React.SetStateAction<Record<Tab, number>>>;
  reversed: boolean;
  filtered: boolean;
}) {
  const setFilter = (k: keyof Filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPages({ active: 1, history: 1 });
  };
  // status options: only what this tab actually holds, in timeline order (cancelled last), with counts
  const stepOrder = (r: PublicJobSummary) =>
    r.step ? TRACK_STEPS.findIndex((s) => s.key === r.step) : TRACK_STEPS.length;
  const statusOptions = [...new Set([...tabRows].sort((a, b) => stepOrder(a) - stepOrder(b)).map(statusKey))].map(
    (key) => ({ key, label: key, n: tabRows.filter((r) => statusKey(r) === key).length }),
  );
  return (
    <div className="grid gap-2 border-b border-border px-5 py-3 sm:grid-cols-2">
      <label className="relative sm:col-span-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.q}
          onChange={(e) => setFilter('q', e.target.value)}
          placeholder="ค้นหาเลขที่งาน รุ่นสินค้า หรือ S/N 4 ตัวท้าย"
          className="pl-8"
          maxLength={50}
          aria-label="ค้นหา"
        />
      </label>
      <Select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} aria-label="สถานะ">
        <option value="">ทุกสถานะ</option>
        {statusOptions.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label} ({o.n})
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={filters.from}
          max={filters.to || undefined}
          onChange={(e) => setFilter('from', e.target.value)}
          aria-label="รับเครื่องตั้งแต่วันที่"
        />
        <span className="shrink-0 text-xs text-muted-foreground">ถึง</span>
        <Input
          type="date"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(e) => setFilter('to', e.target.value)}
          aria-label="รับเครื่องถึงวันที่"
        />
      </div>
      {reversed && (
        <p role="alert" className="text-xs font-medium text-danger sm:col-span-2">
          วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด
        </p>
      )}
      {filtered && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground sm:col-span-2">
          <span>
            พบ <span className="num">{found}</span> จาก <span className="num">{tabRows.length}</span> รายการ · วันที่ =
            วันที่รับเครื่อง
          </span>
          <button
            type="button"
            onClick={() => {
              setFilters(NO_FILTERS);
              setPages({ active: 1, history: 1 });
            }}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            <X className="h-3.5 w-3.5" /> ล้างตัวกรอง
          </button>
        </div>
      )}
    </div>
  );
}

function JobRows({
  rows,
  tab,
  busy,
  onOpen,
}: {
  rows: PublicJobSummary[];
  tab: Tab;
  busy: boolean;
  onOpen: (no: string) => void;
}) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.no}>
          <button
            type="button"
            onClick={() => onOpen(r.no)}
            disabled={busy}
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent/40 disabled:opacity-60"
          >
            {/* a long status ("ใบเสนอราคาหมดอายุแล้ว — …") wraps onto its own line instead of squeezing the details */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="min-w-[12rem] flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="num text-sm font-semibold">{r.no}</span>
                  <span className="truncate text-sm">{r.brandModel || '—'}</span>
                </p>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  {r.deviceRef && <span className="num">S/N {r.deviceRef} · </span>}
                  รับเครื่อง <span className="num">{r.receivedDate || '—'}</span>
                  {r.closedDate && (
                    <>
                      {' · '}ปิดงาน <span className="num">{r.closedDate}</span>
                    </>
                  )}
                </p>
              </div>
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-2xs font-medium',
                  r.cancelled
                    ? 'bg-danger-soft text-danger'
                    : tab === 'history'
                      ? 'bg-success-soft text-success'
                      : 'bg-primary-soft text-primary',
                )}
              >
                {r.stepLabel}
              </span>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Pager({
  page,
  totalPages,
  count,
  goPage,
}: {
  page: number;
  totalPages: number;
  count: number;
  goPage: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
      <span className="num">
        แสดง {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, count)} จาก {count} รายการ
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => goPage(page - 1)}
          disabled={page === 1}
          className="rounded-md border border-border p-1.5 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label="ก่อนหน้า"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="num min-w-[70px] text-center">
          หน้า {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => goPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded-md border border-border p-1.5 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label="ถัดไป"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
