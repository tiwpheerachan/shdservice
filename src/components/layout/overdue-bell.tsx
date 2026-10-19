'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, CalendarClock, Clock, UserRound, UserX } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/shadcn/popover';
import { baht, cn } from '@/lib/utils';
import type { OverdueAlerts, PendingSaleOrders } from '@/server/services/alerts';
import { useApi } from '@/data/db';
import { useAccess } from '@/lib/use-access';

/** background refresh; opening the bell re-checks when the last answer is older than a minute */
const POLL_MS = 5 * 60_000;
const FRESH_MS = 60_000;

/**
 * Topbar bell, two sections:
 *  - approvers (SO Approve + Sale Order edit, as approving needs): sale orders waiting for
 *    approval, minus their own (GET /api/alerts/sale-orders-pending)
 *  - open jobs past their customer due date, each with who is responsible
 *    (GET /api/alerts/overdue — who takes jobs sees their own, everyone else all of them)
 * The badge sums both. A quiet background poll (every 5 min, only while the tab is visible): a failed
 * answer just hides that count. A role with neither section (the APIs' 403) gets no bell at all.
 */
export function OverdueBell() {
  const { can, has, jobLink } = useAccess();
  const allowed = can('Job Management', 'view');
  const approver = has('SO Approve') && can('Sale Order', 'edit');
  // quiet background poll through swr: every 5 min, paused while the tab is hidden, once more
  // when a tab comes back after that long; a failed answer keeps the last one on screen
  const poll = { quiet: true, refreshInterval: POLL_MS, revalidateOnFocus: true };
  // first read a few seconds after the page has finished loading — its JS and its own data go first on a
  // slow phone (requestIdleCallback fired during the network wait, measured 2026-10-19) — or at once when
  // the bell is opened
  const [idle, setIdle] = React.useState(false);
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      t = setTimeout(() => setIdle(true), 3000);
    };
    if (document.readyState === 'complete') later();
    else window.addEventListener('load', later, { once: true });
    return () => {
      window.removeEventListener('load', later);
      clearTimeout(t);
    };
  }, []);
  const { data, error, mutate, ageMs } = useApi<OverdueAlerts>(allowed && idle ? '/api/alerts/overdue' : null, poll);
  const so = useApi<PendingSaleOrders>(approver && idle ? '/api/alerts/sale-orders-pending' : null, poll);
  const [open, setOpen] = React.useState(false);
  if (!allowed && !approver) return null;

  const total = data?.total ?? 0;
  const waiting = so.data?.total ?? 0;
  const badge = total + waiting;
  const label = [total && `งานเกินกำหนดส่ง ${total} งาน`, waiting && `ใบสั่งขายรออนุมัติ ${waiting} ใบ`]
    .filter(Boolean)
    .join(' · ');
  const mine = data?.scope === 'mine';
  const listHref = (engineerId?: number | null) =>
    `/jobs/list?src=overdue${engineerId ? `&engineer=${engineerId}` : ''}`;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setIdle(true);
        if (v && ageMs() > FRESH_MS) void mutate();
        if (v && so.ageMs() > FRESH_MS) void so.mutate();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label || 'การแจ้งเตือน'}
          title={label || 'การแจ้งเตือน'}
          className="relative rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:border-input hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {badge > 0 && (
            <span className="num absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white dark:text-background">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-(--radix-popover-content-available-height) w-[min(400px,calc(100vw-24px))] overflow-y-auto p-0"
      >
        {approver && (
          <div className="border-b border-border">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">
                ใบสั่งขายรออนุมัติ (<span className="num">{waiting.toLocaleString('en-US')}</span>)
              </p>
              <p className="text-2xs text-muted-foreground">
                ไม่รวมใบที่คุณสร้างเองหรือเป็นพนักงานขาย (อนุมัติเองไม่ได้)
              </p>
            </div>
            {!so.data ? (
              <p className="px-4 py-4 text-center text-sm text-muted-foreground">
                {so.error ? 'โหลดใบสั่งขายรออนุมัติไม่สำเร็จ ลองเปิดใหม่อีกครั้ง' : 'กำลังโหลด…'}
              </p>
            ) : waiting === 0 ? (
              <p className="px-4 py-4 text-center text-sm text-muted-foreground">ไม่มีใบสั่งขายรออนุมัติ</p>
            ) : (
              <>
                <ul className="max-h-[min(260px,35vh)] divide-y divide-border overflow-y-auto">
                  {so.data.items.map((o) => (
                    <li key={o.no}>
                      <Link
                        href={`/sale/orders/edit?no=${encodeURIComponent(o.no)}`}
                        onClick={() => setOpen(false)}
                        className="block px-4 py-2.5 transition-colors hover:bg-accent/50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="num text-sm font-semibold text-primary">{o.no}</span>
                          <span
                            title="นับจากวันที่สร้างใบสั่งขาย"
                            className="num inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-medium text-warning"
                          >
                            <Clock className="h-3 w-3" />{' '}
                            {o.days ? `รอ ${o.days.toLocaleString('en-US')} วัน` : 'วันนี้'}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs">
                          {o.customer || '—'} · <span className="num">{baht(o.amount)}</span> บาท
                        </p>
                        <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                          สร้างโดย {o.createdBy || '—'} · <span className="num">{o.date}</span>
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/sale/orders?pending=1"
                  onClick={() => setOpen(false)}
                  className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-primary hover:bg-accent/50"
                >
                  ดูทั้งหมด
                </Link>
              </>
            )}
          </div>
        )}

        {allowed && (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold">งานเกินกำหนดส่ง</p>
                <p className="text-2xs text-muted-foreground">
                  {mine ? 'งานที่คุณรับผิดชอบ' : 'งานค้างทั้งหมด ณ ตอนนี้'} · ยังไม่ปิดงาน
                  และเลยวันที่กำหนดส่งลูกค้าแล้ว
                </p>
              </div>
              <span
                className={cn(
                  'num rounded-full px-2 py-0.5 text-xs font-semibold',
                  total ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success',
                )}
              >
                {total.toLocaleString('en-US')}
              </span>
            </div>

            {!data ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {error ? 'โหลดการแจ้งเตือนไม่สำเร็จ ลองเปิดใหม่อีกครั้ง' : 'กำลังโหลด…'}
              </p>
            ) : total === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">ไม่มีงานเกินกำหนดส่ง</p>
            ) : (
              <>
                {/* who holds them (everyone but engineers) */}
                {!mine && (data.owners.length > 0 || data.unassigned > 0) && (
                  <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
                    {data.unassigned > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-medium text-warning">
                        <UserX className="h-3 w-3" /> ยังไม่มอบหมายช่าง{' '}
                        <span className="num">{data.unassigned.toLocaleString('en-US')}</span>
                      </span>
                    )}
                    {data.owners.map((o) => (
                      <Link
                        key={o.engineerId ?? o.name}
                        href={listHref(o.engineerId)}
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-2xs text-foreground transition-colors hover:bg-accent"
                      >
                        {o.name} <span className="num text-muted-foreground">{o.count.toLocaleString('en-US')}</span>
                      </Link>
                    ))}
                  </div>
                )}

                <ul className="max-h-[min(420px,60vh)] divide-y divide-border overflow-y-auto">
                  {data.items.map((j) => (
                    <li key={j.no}>
                      <Link
                        {...jobLink(j.no)}
                        onClick={() => setOpen(false)}
                        className="block px-4 py-2.5 transition-colors hover:bg-accent/50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="num text-sm font-semibold text-primary">{j.no}</span>
                          <span className="num inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-medium text-danger">
                            <CalendarClock className="h-3 w-3" /> เกิน {j.daysOver.toLocaleString('en-US')} วัน
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs">
                          {j.product || '—'}
                          {j.customer && <span className="text-muted-foreground"> · {j.customer}</span>}
                        </p>
                        <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                          {j.status} · กำหนดส่ง <span className="num">{j.dueDate}</span>
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs">
                          {j.engineer ? (
                            <span className="inline-flex items-center gap-1 font-medium">
                              <UserRound className="h-3 w-3 text-muted-foreground" /> ช่าง: {j.engineer}
                            </span>
                          ) : (
                            <>
                              <span className="inline-flex items-center gap-1 rounded bg-warning-soft px-1.5 py-px font-medium text-warning">
                                <UserX className="h-3 w-3" /> ยังไม่มอบหมายช่าง
                              </span>
                              {/* who opened the job — not an assignee ("ผู้รับงาน" next to "no engineer" read as a contradiction) */}
                              {j.openedBy && <span className="text-muted-foreground">เปิดงานโดย: {j.openedBy}</span>}
                            </>
                          )}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>

                <Link
                  href={listHref(data.engineerId)}
                  onClick={() => setOpen(false)}
                  className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-primary hover:bg-accent/50"
                >
                  {total > data.items.length
                    ? `ดูทั้งหมด ${total.toLocaleString('en-US')} งานในรายการงาน`
                    : 'เปิดในรายการงาน'}
                </Link>
              </>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
