"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, CalendarClock, UserRound, UserX } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { cn } from "@/lib/utils";
import type { OverdueAlerts } from "@/server/services/alerts";
import { useApi } from "@/data/db";

/** background refresh; opening the bell re-checks when the last answer is older than a minute */
const POLL_MS = 5 * 60_000;
const FRESH_MS = 60_000;

/**
 * Topbar bell: open jobs past their customer due date, each with who is responsible
 * (GET /api/alerts/overdue — an Engineer sees their own jobs, everyone else all of them).
 * A quiet background poll (every 5 min, only while the tab is visible): a failed / forbidden
 * answer just hides the badge.
 */
export function OverdueBell() {
  // quiet background poll through swr: every 5 min, paused while the tab is hidden, once more
  // when a tab comes back after that long; a failed answer keeps the last one on screen
  const { data, mutate, ageMs } = useApi<OverdueAlerts>("/api/alerts/overdue", {
    quiet: true,
    refreshInterval: POLL_MS,
    revalidateOnFocus: true,
  });
  const [open, setOpen] = React.useState(false);

  const total = data?.total ?? 0;
  const mine = data?.scope === "mine";
  const listHref = (engineerId?: number | null) =>
    `/jobs/list?src=overdue${engineerId ? `&engineer=${engineerId}` : ""}`;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v && ageMs() > FRESH_MS) void mutate();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={total ? `งานเกินกำหนดส่ง ${total} งาน` : "การแจ้งเตือน"}
          title="งานเกินกำหนดส่ง"
          className="relative rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:border-input hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {total > 0 && (
            <span className="num absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
              {total > 99 ? "99+" : total}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(400px,calc(100vw-24px))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">งานเกินกำหนดส่ง</p>
            <p className="text-2xs text-muted-foreground">
              {mine ? "งานที่คุณรับผิดชอบ" : "ทุกงาน"} · ยังไม่ปิดงาน และเลยวันที่กำหนดส่งลูกค้าแล้ว
            </p>
          </div>
          <span className={cn("num rounded-full px-2 py-0.5 text-xs font-semibold", total ? "bg-danger-soft text-danger" : "bg-success-soft text-success")}>
            {total.toLocaleString("en-US")}
          </span>
        </div>

        {!data ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">กำลังโหลด…</p>
        ) : total === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">ไม่มีงานเกินกำหนดส่ง</p>
        ) : (
          <>
            {/* who holds them (everyone but engineers) */}
            {!mine && (data.owners.length > 0 || data.unassigned > 0) && (
              <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
                {data.unassigned > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-medium text-warning">
                    <UserX className="h-3 w-3" /> ยังไม่มอบหมายช่าง <span className="num">{data.unassigned.toLocaleString("en-US")}</span>
                  </span>
                )}
                {data.owners.map((o) => (
                  <Link
                    key={o.engineerId ?? o.name}
                    href={listHref(o.engineerId)}
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-2xs text-foreground transition-colors hover:bg-accent"
                  >
                    {o.name} <span className="num text-muted-foreground">{o.count.toLocaleString("en-US")}</span>
                  </Link>
                ))}
              </div>
            )}

            <ul className="max-h-[min(420px,60vh)] divide-y divide-border overflow-y-auto">
              {data.items.map((j) => (
                <li key={j.no}>
                  <Link
                    href={`/jobs/repair?job=${encodeURIComponent(j.no)}`}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-2.5 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="num text-sm font-semibold text-primary">{j.no}</span>
                      <span className="num inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-medium text-danger">
                        <CalendarClock className="h-3 w-3" /> เกิน {j.daysOver.toLocaleString("en-US")} วัน
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs">
                      {j.product || "—"}
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
                          {j.openedBy && <span className="text-muted-foreground">ผู้รับงาน: {j.openedBy}</span>}
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
                ? `ดูทั้งหมด ${total.toLocaleString("en-US")} งานในรายการงาน`
                : "เปิดในรายการงาน"}
            </Link>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
