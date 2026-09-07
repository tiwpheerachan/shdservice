"use client";

import { ReportView } from "@/components/shared/report-view";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { CHANNELS, type Job } from "@/data/mock";
import { useJobs, useJobTypes } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { int } from "@/lib/utils";

const columns: Column<Job>[] = [
  { key: "no", header: "เลขที่งาน", width: "130px", cell: (r) => <span className="num font-medium">{r.no}</span> },
  { key: "openDate", header: "วันที่เปิดงาน", width: "140px", cell: (r) => <span className="num text-xs">{r.openDate}</span> },
  { key: "customer", header: "ลูกค้า", cell: (r) => <span className="line-clamp-1 max-w-[220px]">{r.customer}</span> },
  { key: "so", header: "เลขคำสั่งซื้อ", hideBelow: "lg", cell: (r) => <span className="num text-xs">{r.so}</span> },
  { key: "brandModel", header: "ยี่ห้อ, รุ่น", hideBelow: "md" },
  { key: "jobType", header: "ประเภทงาน", hideBelow: "xl", cell: (r) => <Badge tone="primary">{r.jobType}</Badge> },
  { key: "owner", header: "ผู้รับผิดชอบ", hideBelow: "lg" },
  { key: "status", header: "สถานะงาน", width: "150px", cell: (r) => <StatusBadge status={r.status} /> },
];

export default function Page() {
  const { data: JOBS, loading } = useJobs();
  const { data: JOB_TYPES } = useJobTypes();
  const newJobs = JOBS.filter((j) => j.status === "งานใหม่").length;
  return (
    <ReportView
      title="รายงานการเปิดงานซ่อม"
      description="สรุปงานที่เปิดใหม่ในระบบตามช่วงเวลาที่กำหนด"
      filters={[
        { kind: "date", label: "วันที่เปิดงาน (ตั้งแต่)", value: "2026-08-05" },
        { kind: "date", label: "วันที่เปิดงาน (ถึง)", value: "2026-09-04" },
        { kind: "select", label: "ประเภทงาน", options: ["- - Select All - -", ...JOB_TYPES.map((j) => j.name)] },
        { kind: "select", label: "ช่องทางการขาย", options: ["- - Select All - -", ...CHANNELS] },
      ]}
      kpis={[
        { label: "งานที่เปิดทั้งหมด", value: int(JOBS.length), tone: "primary" },
        { label: "งานใหม่ (ยังไม่เริ่ม)", value: int(newJobs), tone: "warning" },
        { label: "เฉลี่ยต่อวัน", value: (JOBS.length / 30).toFixed(1) },
        { label: "ช่องทางหลัก", value: "Shopee" },
      ]}
      columns={columns}
      rows={JOBS}
      loading={loading}
      rowKey={(r) => r.no}
    />
  );
}
