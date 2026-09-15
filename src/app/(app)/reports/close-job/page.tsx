"use client";

import * as React from "react";
import { ReportView, type ReportValues } from "@/components/shared/report-view";
import type { ServerTableState } from "@/components/ui/data-table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { RETURN_METHODS, type Job } from "@/data/mock";
import { useJobsPage, useJobSummary } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { baht, int } from "@/lib/utils";
import { daysAgo, today } from "@/lib/dates";

// TAT = วันที่ปิดงาน − วันที่เปิดงาน
const tatDays = (r: Job) => {
  if (!r.closedDate || !r.openDate) return 0;
  return Math.max(0, Math.round((new Date(r.closedDate.replace(" ", "T")).getTime() - new Date(r.openDate.replace(" ", "T")).getTime()) / 86400000));
};

const columns: Column<Job>[] = [
  { key: "no", header: "เลขที่งาน", width: "130px", cell: (r) => <span className="num font-medium">{r.no}</span> },
  { key: "openDate", header: "วันที่เปิดงาน", width: "140px", cell: (r) => <span className="num text-xs">{r.openDate}</span> },
  { key: "customer", header: "ลูกค้า", cell: (r) => <span className="line-clamp-1 max-w-[200px]">{r.customer}</span> },
  { key: "brandModel", header: "ยี่ห้อ, รุ่น", hideBelow: "md" },
  {
    key: "tat",
    header: "TAT (วัน)",
    align: "right",
    width: "100px",
    value: (r) => tatDays(r),
    cell: (r) => {
      const d = tatDays(r);
      return <span className={d > 10 ? "text-danger font-semibold" : ""}>{d}</span>;
    },
  },
  {
    key: "returnType",
    header: "วิธีส่งคืน",
    hideBelow: "lg",
    cell: (r) => (r.returnType ? <Badge tone="info">{r.returnType}</Badge> : <span className="text-muted-foreground">—</span>),
  },
  { key: "paymentAmount", header: "ยอดรับชำระ", align: "right", width: "120px", value: (r) => r.paymentAmount ?? 0, cell: (r) => baht(r.paymentAmount ?? 0) },
  { key: "status", header: "สถานะงาน", width: "140px", cell: (r) => <StatusBadge status={r.status} /> },
];

export default function Page() {
  const [f, setF] = React.useState<ReportValues>({ from: daysAgo(30), to: today(), returnType: "", no: "" });
  const filters = { closedFrom: f.from, closedTo: f.to, statusGroup: "Finished", returnType: f.returnType };
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  const pageArgs = { page: table.page, pageSize: table.pageSize, q: table.q, sort: table.sort?.key, dir: table.sort?.dir };
  const { data: sum } = useJobSummary({ ...filters, q: f.no });
  const { rows: JOBS, total: totalRows, loading } = useJobsPage({ ...pageArgs, q: table.q || f.no, ...filters });
  const S = sum[0];
  const total = S?.paid ?? 0;
  const avg = String(S?.avgTat ?? 0);
  const over30 = S?.over30 ?? 0;
  return (
    <ReportView
      title="รายงานการปิดงานซ่อม"
      description="งานที่ปิดแล้ว วิธีการส่งคืน และระยะเวลาดำเนินงาน (TAT)"
      filters={[
        { kind: "date", key: "from", label: "วันที่ปิดงาน (ตั้งแต่)", value: f.from },
        { kind: "date", key: "to", label: "วันที่ปิดงาน (ถึง)", value: f.to },
        { kind: "select", key: "returnType", label: "วิธีการส่งคืน", options: ["- - Select All - -", ...RETURN_METHODS] },
        { kind: "text", key: "no", label: "เลขที่งาน", placeholder: "J2612164" },
      ]}
      onApply={setF}
      kpis={[
        { label: "งานที่ปิดแล้ว", value: int(S?.total ?? 0), tone: "success" },
        { label: "ยอดรับชำระรวม", value: baht(total) },
        { label: "TAT เฉลี่ย (วัน)", value: avg },
        { label: "เกิน 30 วัน", value: int(over30), tone: "danger" },
      ]}
      columns={columns}
      rows={JOBS}
      loading={loading}
      rowKey={(r) => r.no}
      server={{ total: totalRows, onChange: setTable }}
    />
  );
}
