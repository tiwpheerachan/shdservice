"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import {
  useDashGroups,
  useTatRows,
  useMonthly,
  useTopSymptoms,
  useJobs,
} from "@/data/db";
import { int, cn } from "@/lib/utils";

/* one restrained accent per status group — carried as a small dot + thin bar, never a fill */
const TONE: Record<string, string> = {
  pending: "bg-warning",
  repaired: "bg-info",
  finished: "bg-success",
  total: "bg-primary",
};

function tatBand(status: string) {
  if (/เสร็จ|ปิดงาน|ส่งคืน|Complete/i.test(status)) return "bg-success";
  if (/เบิก|ซ่อม|out-?source/i.test(status)) return "bg-info";
  return "bg-warning";
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
    <section
      className={cn(
        "rounded-xl border border-border bg-card",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {meta && <div className="text-2xs text-muted-foreground">{meta}</div>}
      </div>
      <div className={cn("p-5", bodyClass)}>{children}</div>
    </section>
  );
}

export default function DashboardPage() {
  const [range, setRange] = React.useState("30d");

  const { data: DASH_GROUPS } = useDashGroups();
  const { data: TAT_ROWS } = useTatRows();
  const { data: MONTHLY } = useMonthly();
  const { data: TOP_SYMPTOMS } = useTopSymptoms();
  const { data: JOBS } = useJobs();

  const maxSymptom = Math.max(1, ...TOP_SYMPTOMS.map((s) => s.count));

  const tat = TAT_ROWS.map((r) => ({
    ...r,
    total: r.d13 + r.d47 + r.d814 + r.d1530 + r.over30,
  }));
  const grand = tat.reduce(
    (a, r) => ({
      d13: a.d13 + r.d13, d47: a.d47 + r.d47, d814: a.d814 + r.d814,
      d1530: a.d1530 + r.d1530, over30: a.over30 + r.over30, total: a.total + r.total,
    }),
    { d13: 0, d47: 0, d814: 0, d1530: 0, over30: 0, total: 0 }
  );
  const dayCols = [
    { k: "d13" as const, label: "1–3 วัน" },
    { k: "d47" as const, label: "4–7 วัน" },
    { k: "d814" as const, label: "8–14 วัน" },
    { k: "d1530" as const, label: "15–30 วัน" },
    { k: "over30" as const, label: "เกิน 30 วัน" },
  ];

  /* monthly line chart geometry */
  const W = 640, H = 190, padL = 8, padR = 8, padT = 14, padB = 8;
  const iw = W - padL - padR, ih = H - padT - padB;
  const maxM = Math.max(1, ...MONTHLY.flatMap((m) => [m.open, m.close]));
  const px = (i: number) =>
    padL + (MONTHLY.length <= 1 ? iw / 2 : (i / (MONTHLY.length - 1)) * iw);
  const py = (v: number) => padT + ih - (v / maxM) * ih;
  const line = (key: "open" | "close") =>
    MONTHLY.map((m, i) => `${px(i)},${py(m[key])}`).join(" ");
  const area = (key: "open" | "close") =>
    MONTHLY.length
      ? `${padL},${padT + ih} ${line(key)} ${padL + iw},${padT + ih}`
      : "";

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-2xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Service Operations
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">ภาพรวมงานบริการ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            สถานะงานซ่อมและระยะเวลาดำเนินงาน (TAT) · ณ 7 ก.ย. 2026
          </p>
        </div>
        <div className="flex items-center gap-3">
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
          <Link
            href="/jobs/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            เปิดงานใหม่
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* KPI band — hairline-separated cells, no gradient fills */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {DASH_GROUPS.map((g) => (
          <Link
            key={g.key}
            href="/jobs/list"
            className="group bg-card p-5 transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full", TONE[g.key])} />
              <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                {g.label}
              </span>
            </div>
            <p className="num mt-3 text-[30px] font-semibold leading-none tracking-tight tabular-nums">
              {int(g.jobs)}
            </p>
            <div className="mt-3.5 flex items-center gap-2.5">
              <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn("block h-full rounded-full", TONE[g.key])}
                  style={{ width: `${Math.min(100, g.percent)}%` }}
                />
              </span>
              <span className="num text-2xs tabular-nums text-muted-foreground">
                {g.percent.toFixed(2)}%
              </span>
            </div>
            <p className="mt-2 text-2xs text-muted-foreground">{g.sub}</p>
          </Link>
        ))}
      </div>

      {/* TAT matrix */}
      <Panel
        title="TAT — ระยะเวลาตั้งแต่วันเปิดงานถึงวันส่งคืน"
        meta={<span>จำแนกตามสถานะงานและช่วงจำนวนวัน</span>}
        bodyClass="p-0"
      >
        <div className="table-scroll">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 py-2.5 pl-5 text-left font-medium">#</th>
                <th className="py-2.5 pr-4 text-left font-medium">สถานะงาน</th>
                {dayCols.map((c) => (
                  <th key={c.k} className="px-4 py-2.5 text-right font-medium">{c.label}</th>
                ))}
                <th className="py-2.5 pr-5 text-right font-medium">รวม</th>
              </tr>
            </thead>
            <tbody>
              {tat.map((r, i) => (
                <tr key={r.status} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                  <td className="py-2.5 pl-5">
                    <span className="flex items-center gap-2.5">
                      <span className={cn("h-3.5 w-[3px] rounded-full", tatBand(r.status))} />
                      <span className="num text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-medium">{r.status}</td>
                  {(["d13", "d47", "d814", "d1530"] as const).map((k) => (
                    <td key={k} className="num px-4 py-2.5 text-right tabular-nums">
                      {r[k] || <span className="text-muted-foreground/30">–</span>}
                    </td>
                  ))}
                  <td className="num px-4 py-2.5 text-right tabular-nums">
                    <span className={cn(r.over30 > 20 && "font-semibold text-danger")}>
                      {r.over30 || <span className="text-muted-foreground/30">–</span>}
                    </span>
                  </td>
                  <td className="num py-2.5 pr-5 text-right font-semibold tabular-nums">{int(r.total)}</td>
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
                      {int(grand[c.k])}
                    </td>
                  ))}
                  <td className="num py-2.5 pr-5 text-right font-semibold tabular-nums text-primary">
                    {int(grand.total)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* monthly line chart */}
        <Panel
          title="แนวโน้มงานเปิด / ปิด รายเดือน"
          className="lg:col-span-2"
          meta={
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />เปิดงาน</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" />ปิดงาน</span>
            </div>
          }
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }} preserveAspectRatio="none" role="img" aria-label="แนวโน้มรายเดือน">
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <line key={f} x1={padL} x2={padL + iw} y1={padT + ih - f * ih} y2={padT + ih - f * ih}
                stroke="hsl(var(--border))" strokeWidth="1" />
            ))}
            {MONTHLY.length > 0 && (
              <>
                <polygon points={area("close")} fill="hsl(var(--success))" fillOpacity="0.08" />
                <polygon points={area("open")} fill="hsl(var(--primary))" fillOpacity="0.10" />
                <polyline points={line("close")} fill="none" stroke="hsl(var(--success))" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
                <polyline points={line("open")} fill="none" stroke="hsl(var(--primary))" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
                {MONTHLY.map((m, i) => (
                  <g key={m.m}>
                    <circle cx={px(i)} cy={py(m.open)} r="2.5" fill="hsl(var(--primary))" />
                    <circle cx={px(i)} cy={py(m.close)} r="2.5" fill="hsl(var(--success))" />
                  </g>
                ))}
              </>
            )}
          </svg>
          <div className="mt-2 flex justify-between px-1 text-2xs text-muted-foreground">
            {MONTHLY.map((m) => <span key={m.m}>{m.m}</span>)}
          </div>
        </Panel>

        {/* top symptoms */}
        <Panel title="อาการเสียที่พบบ่อย" meta={<span>Top {TOP_SYMPTOMS.length}</span>}>
          <ol className="space-y-3.5">
            {TOP_SYMPTOMS.map((s, i) => (
              <li key={s.name}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate">
                    <span className="num mr-2 text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                    {s.name}
                  </span>
                  <span className="num shrink-0 font-medium tabular-nums">{int(s.count)}</span>
                </div>
                <span className="block h-[3px] overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary/70"
                    style={{ width: `${(s.count / maxSymptom) * 100}%` }} />
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      {/* recent jobs */}
      <Panel
        title="งานล่าสุด"
        meta={<Link href="/jobs/list" className="font-medium text-primary hover:underline">ดูทั้งหมด →</Link>}
        bodyClass="p-0"
      >
        <div className="table-scroll">
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
              {JOBS.slice(0, 6).map((j) => {
                const done = /เสร็จ|ปิดงาน/.test(j.status);
                const fresh = j.status === "งานใหม่";
                return (
                  <tr key={j.no} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                    <td className="num py-2.5 pl-5 font-medium text-primary">{j.no}</td>
                    <td className="num py-2.5 text-xs text-muted-foreground">{j.openDate}</td>
                    <td className="max-w-[220px] truncate py-2.5 pr-3">{j.customer}</td>
                    <td className="hidden py-2.5 pr-3 md:table-cell">{j.brandModel}</td>
                    <td className="hidden py-2.5 pr-3 text-muted-foreground lg:table-cell">{j.owner}</td>
                    <td className="py-2.5 pr-5">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={cn("h-1.5 w-1.5 rounded-full",
                          done ? "bg-success" : fresh ? "bg-info" : "bg-warning")} />
                        {j.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
