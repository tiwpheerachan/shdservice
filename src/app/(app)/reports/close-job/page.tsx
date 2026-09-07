"use client";

import { ReportView } from "@/components/shared/report-view";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { RETURN_METHODS, type Job } from "@/data/mock";
import { useJobs } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { baht, int } from "@/lib/utils";

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
    sortable: false,
    cell: (_r, i) => {
      const d = 3 + (i % 12);
      return <span className={d > 10 ? "text-danger font-semibold" : ""}>{d}</span>;
    },
  },
  {
    key: "method",
    header: "วิธีส่งคืน",
    hideBelow: "lg",
    sortable: false,
    cell: (_r, i) => <Badge tone="info">{RETURN_METHODS[i % RETURN_METHODS.length]}</Badge>,
  },
  { key: "amount", header: "ยอดรับชำระ", align: "right", width: "120px", value: (r) => r.amount, cell: (r) => baht(r.amount) },
  { key: "status", header: "สถานะงาน", width: "140px", cell: (r) => <StatusBadge status={r.status} /> },
];

export default function Page() {
  const { data: JOBS, loading } = useJobs();
  const closed = JOBS.filter((j) => j.status === "ปิดงาน" || j.status === "ซ่อมเสร็จ");
  const total = closed.reduce((s, j) => s + j.amount, 0);
  return (
    <ReportView
      title="รายงานการปิดงานซ่อม"
      description="งานที่ปิดแล้ว วิธีการส่งคืน และระยะเวลาดำเนินงาน (TAT)"
      filters={[
        { kind: "date", label: "วันที่ปิดงาน (ตั้งแต่)", value: "2026-08-05" },
        { kind: "date", label: "วันที่ปิดงาน (ถึง)", value: "2026-09-04" },
        { kind: "select", label: "วิธีการส่งคืน", options: ["- - Select All - -", ...RETURN_METHODS] },
        { kind: "text", label: "เลขที่งาน", placeholder: "JOB2604460" },
      ]}
      kpis={[
        { label: "งานที่ปิดแล้ว", value: int(closed.length), tone: "success" },
        { label: "ยอดรับชำระรวม", value: baht(total) },
        { label: "TAT เฉลี่ย (วัน)", value: "7.4" },
        { label: "เกิน 30 วัน", value: "101", tone: "danger" },
      ]}
      columns={columns}
      rows={closed}
      loading={loading}
      rowKey={(r) => r.no}
    />
  );
}
