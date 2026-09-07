"use client";

import * as React from "react";
import Link from "next/link";
import {
  Clock3,
  Wrench,
  CheckCircle2,
  Layers,
  TrendingUp,
  Activity,
  ArrowRight,
  ArrowUpRight,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Section } from "@/components/shared/section";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  useDashGroups,
  useTatRows,
  useMonthly,
  useTopSymptoms,
  useJobs,
} from "@/data/db";
import type { DashGroup } from "@/data/mock";
import { int, cn } from "@/lib/utils";

/* premium gradient + icon per group (mirrors the legacy colour coding) */
const GROUP_STYLE: Record<
  string,
  { grad: string; icon: React.ElementType; ring: string }
> = {
  pending: {
    grad: "from-rose-500 to-red-600",
    icon: Clock3,
    ring: "shadow-rose-500/25",
  },
  repaired: {
    grad: "from-amber-400 to-orange-500",
    icon: Wrench,
    ring: "shadow-orange-500/25",
  },
  finished: {
    grad: "from-emerald-500 to-green-600",
    icon: CheckCircle2,
    ring: "shadow-emerald-500/25",
  },
  total: {
    grad: "from-blue-600 to-indigo-700",
    icon: Layers,
    ring: "shadow-blue-600/25",
  },
};

/* classify a TAT status into a colour band like the legacy dashboard */
function tatTone(status: string): "danger" | "warning" | "success" {
  if (/เสร็จ|ปิดงาน|ส่งคืน/.test(status)) return "success";
  if (/เบิก|ซ่อม|out-?source/i.test(status)) return "warning";
  return "danger";
}
const BAND: Record<string, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  success: "bg-success",
};

function KpiCard({ g }: { g: DashGroup }) {
  const s = GROUP_STYLE[g.key] ?? GROUP_STYLE.total;
  const Icon = s.icon;
  return (
    <Link
      href="/jobs/list"
      className={cn(
        "group relative overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-lg transition-transform duration-200 hover:-translate-y-0.5",
        s.grad,
        s.ring
      )}
    >
      {/* decorative watermark */}
      <Icon className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 opacity-10" />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-white/85">{g.label}</p>
          <p className="mt-1.5 flex items-baseline gap-1.5">
            <span className="num text-3xl font-bold tracking-tight">
              {int(g.jobs)}
            </span>
            <span className="text-xs text-white/75">Jobs</span>
          </p>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/20 backdrop-blur">
          <Icon className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
          <div
            className="h-full rounded-full bg-white/90 transition-all duration-700"
            style={{ width: `${Math.min(100, g.percent)}%` }}
          />
        </div>
        <span className="num text-xs font-semibold">{g.percent.toFixed(2)}%</span>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-2xs text-white/85">
        <span className="truncate">{g.sub}</span>
        <span className="inline-flex items-center gap-0.5 font-medium opacity-90 transition-transform group-hover:translate-x-0.5">
          More info <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const [range, setRange] = React.useState("30d");

  const { data: DASH_GROUPS, loading: loadingGroups } = useDashGroups();
  const { data: TAT_ROWS, loading: loadingTat } = useTatRows();
  const { data: MONTHLY } = useMonthly();
  const { data: TOP_SYMPTOMS } = useTopSymptoms();
  const { data: JOBS } = useJobs();

  const maxMonthly = Math.max(1, ...MONTHLY.flatMap((m) => [m.open, m.close]));
  const maxSymptom = Math.max(1, ...TOP_SYMPTOMS.map((s) => s.count));

  const tatTotals = TAT_ROWS.map((r) => ({
    ...r,
    total: r.d13 + r.d47 + r.d814 + r.d1530 + r.over30,
  }));
  const grand = tatTotals.reduce(
    (a, r) => ({
      d13: a.d13 + r.d13,
      d47: a.d47 + r.d47,
      d814: a.d814 + r.d814,
      d1530: a.d1530 + r.d1530,
      over30: a.over30 + r.over30,
      total: a.total + r.total,
    }),
    { d13: 0, d47: 0, d814: 0, d1530: 0, over30: 0, total: 0 }
  );

  const dayCols: { key: keyof typeof grand; label: string }[] = [
    { key: "d13", label: "1-3 Days" },
    { key: "d47", label: "4-7 Days" },
    { key: "d814", label: "8-14 Days" },
    { key: "d1530", label: "15-30 Days" },
    { key: "over30", label: "Over 30" },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard งานบริการ"
        description="ภาพรวมสถานะงานซ่อมและระยะเวลาดำเนินงาน (TAT) ณ วันที่ 4 ก.ย. 2026"
        actions={
          <Link href="/jobs/new">
            <Button size="sm">
              เปิดงานใหม่
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        }
      />

      <Tabs
        value={range}
        onChange={setRange}
        tabs={[
          { key: "7d", label: "7 วัน" },
          { key: "30d", label: "30 วัน" },
          { key: "90d", label: "90 วัน" },
          { key: "all", label: "ทั้งหมด" },
        ]}
      />

      {/* KPI group cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loadingGroups && DASH_GROUPS.length === 0
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[132px] animate-pulse rounded-2xl bg-muted"
              />
            ))
          : DASH_GROUPS.map((g) => <KpiCard key={g.key} g={g} />)}
      </div>

      {/* TAT matrix */}
      <Section
        title="TAT — ระยะเวลาตั้งแต่วันเปิดงานถึงวันส่งคืน"
        icon={Activity}
        description="จำแนกตามสถานะงานและช่วงจำนวนวัน"
        bodyClassName="p-0"
      >
        <div className="table-scroll rounded-none">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-3 py-2.5 text-center">#</th>
                <th className="px-3 py-2.5 text-left">สถานะงาน</th>
                {dayCols.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 text-right">
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {loadingTat && tatTotals.length === 0 ? (
                <tr>
                  <td
                    colSpan={dayCols.length + 3}
                    className="px-3 py-12 text-center text-muted-foreground"
                  >
                    <div
                      className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary"
                      aria-hidden
                    />
                    กำลังโหลดข้อมูล…
                  </td>
                </tr>
              ) : (
                tatTotals.map((r, i) => {
                  const tone = tatTone(r.status);
                  return (
                    <tr
                      key={r.status}
                      className="group border-b border-border/70 transition-colors hover:bg-accent/50"
                    >
                      <td className="relative px-3 py-2.5 text-center">
                        <span
                          className={cn(
                            "absolute inset-y-1.5 left-0 w-1 rounded-full",
                            BAND[tone]
                          )}
                        />
                        <span className="num text-xs text-muted-foreground">
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2 font-medium">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              BAND[tone]
                            )}
                          />
                          {r.status}
                        </span>
                      </td>
                      {(["d13", "d47", "d814", "d1530"] as const).map((k) => (
                        <td key={k} className="num px-3 py-2.5 text-right tabular-nums">
                          {r[k] || (
                            <span className="text-muted-foreground/30">—</span>
                          )}
                        </td>
                      ))}
                      <td className="num px-3 py-2.5 text-right tabular-nums">
                        <span
                          className={cn(
                            r.over30 > 20 && "font-semibold text-danger"
                          )}
                        >
                          {r.over30 || (
                            <span className="text-muted-foreground/30">—</span>
                          )}
                        </span>
                      </td>
                      <td className="num bg-muted/30 px-3 py-2.5 text-right font-semibold tabular-nums group-hover:bg-transparent">
                        {int(r.total)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {tatTotals.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/60 font-semibold">
                  <td colSpan={2} className="px-3 py-2.5 text-right">
                    รวมทั้งสิ้น
                  </td>
                  {dayCols.map((c) => (
                    <td
                      key={c.key}
                      className="num px-3 py-2.5 text-right tabular-nums"
                    >
                      {int(grand[c.key])}
                    </td>
                  ))}
                  <td className="num px-3 py-2.5 text-right tabular-nums text-primary">
                    {int(grand.total)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section
          title="แนวโน้มงานเปิด / ปิด รายเดือน"
          icon={TrendingUp}
          className="lg:col-span-2"
        >
          <div className="flex items-end justify-between gap-3 sm:gap-6">
            {MONTHLY.map((m) => (
              <div key={m.m} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-40 w-full items-end justify-center gap-1.5">
                  <div
                    className="w-1/2 max-w-[26px] rounded-t-md bg-gradient-to-t from-primary to-info transition-all duration-500"
                    style={{ height: `${(m.open / maxMonthly) * 100}%` }}
                    title={`เปิดงาน ${m.open}`}
                  />
                  <div
                    className="w-1/2 max-w-[26px] rounded-t-md bg-success/70 transition-all duration-500"
                    style={{ height: `${(m.close / maxMonthly) * 100}%` }}
                    title={`ปิดงาน ${m.close}`}
                  />
                </div>
                <span className="text-2xs text-muted-foreground">{m.m}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-5 border-t border-border pt-3 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> เปิดงาน
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-success/70" /> ปิดงาน
            </span>
          </div>
        </Section>

        <Section title="อาการเสียที่พบบ่อย" icon={Activity}>
          <ul className="space-y-3">
            {TOP_SYMPTOMS.map((s, i) => (
              <li key={s.name}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    <span className="num mr-1.5 text-muted-foreground">{i + 1}.</span>
                    {s.name}
                  </span>
                  <span className="num shrink-0 font-medium">{int(s.count)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-info transition-all duration-500"
                    style={{ width: `${(s.count / maxSymptom) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section
        title="งานล่าสุด"
        icon={Wrench}
        actions={
          <Link
            href="/jobs/list"
            className="text-xs font-medium text-primary hover:underline"
          >
            ดูทั้งหมด
          </Link>
        }
        bodyClassName="p-0"
      >
        <div className="table-scroll rounded-none">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left">เลขที่งาน</th>
                <th className="px-3 py-2 text-left">วันที่เปิดงาน</th>
                <th className="px-3 py-2 text-left">ลูกค้า</th>
                <th className="hidden px-3 py-2 text-left md:table-cell">ยี่ห้อ, รุ่น</th>
                <th className="hidden px-3 py-2 text-left lg:table-cell">ผู้รับผิดชอบ</th>
                <th className="px-3 py-2 text-left">สถานะงาน</th>
              </tr>
            </thead>
            <tbody>
              {JOBS.slice(0, 6).map((j) => (
                <tr
                  key={j.no}
                  className="border-b border-border/70 last:border-0 hover:bg-accent/60"
                >
                  <td className="num px-3 py-2 font-medium text-primary">{j.no}</td>
                  <td className="num px-3 py-2 text-xs">{j.openDate}</td>
                  <td className="max-w-[220px] truncate px-3 py-2">{j.customer}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{j.brandModel}</td>
                  <td className="hidden px-3 py-2 lg:table-cell">{j.owner}</td>
                  <td className="px-3 py-2">
                    <Badge
                      tone={
                        j.status === "ปิดงาน" || j.status === "ซ่อมเสร็จ"
                          ? "success"
                          : j.status === "งานใหม่"
                            ? "info"
                            : "warning"
                      }
                      dot
                    >
                      {j.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
