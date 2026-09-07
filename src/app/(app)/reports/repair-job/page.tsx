"use client";

import { ReportView } from "@/components/shared/report-view";
import { StatusBadge } from "@/components/ui/badge";
import { TECHNICIANS, type Job } from "@/data/mock";
import { useJobs, useSymptoms } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { baht, int } from "@/lib/utils";

const columns: Column<Job>[] = [
  { key: "no", header: "เลขที่งาน", width: "130px", cell: (r) => <span className="num font-medium">{r.no}</span> },
  { key: "customer", header: "ลูกค้า", cell: (r) => <span className="line-clamp-1 max-w-[200px]">{r.customer}</span> },
  { key: "brandModel", header: "ยี่ห้อ, รุ่น", hideBelow: "md" },
  { key: "imei", header: "Serial / IMEI", hideBelow: "xl", cell: (r) => <span className="num text-xs">{r.imei}</span> },
  { key: "owner", header: "ช่างผู้รับผิดชอบ", hideBelow: "lg" },
  { key: "amount", header: "ค่าอะไหล่+บริการ", align: "right", width: "140px", value: (r) => r.amount, cell: (r) => baht(r.amount) },
  { key: "status", header: "สถานะงาน", width: "150px", cell: (r) => <StatusBadge status={r.status} /> },
];

export default function Page() {
  const { data: JOBS, loading } = useJobs();
  const { data: SYMPTOMS } = useSymptoms();
  const done = JOBS.filter((j) => j.status === "ซ่อมเสร็จ" || j.status === "ปิดงาน").length;
  const total = JOBS.reduce((s, j) => s + j.amount, 0);
  const doneRate = JOBS.length ? ((done / JOBS.length) * 100).toFixed(1) : "0";
  return (
    <ReportView
      title="รายงานการซ่อม"
      description="รายละเอียดผลการซ่อม อะไหล่ที่ใช้ และช่างผู้รับผิดชอบ"
      filters={[
        { kind: "date", label: "วันที่ซ่อม (ตั้งแต่)", value: "2026-08-05" },
        { kind: "date", label: "วันที่ซ่อม (ถึง)", value: "2026-09-04" },
        { kind: "select", label: "ช่างผู้รับผิดชอบ", options: ["- - Select All - -", ...TECHNICIANS.slice(1)] },
        { kind: "select", label: "อาการเสีย", options: ["- - Select All - -", ...SYMPTOMS.map((s) => s.name)] },
      ]}
      kpis={[
        { label: "งานที่ดำเนินการ", value: int(JOBS.length), tone: "primary" },
        { label: "ซ่อมสำเร็จ", value: int(done), tone: "success" },
        { label: "มูลค่างานซ่อมรวม", value: baht(total) },
        { label: "อัตราซ่อมสำเร็จ", value: `${doneRate}%`, tone: "success" },
      ]}
      columns={columns}
      rows={JOBS}
      loading={loading}
      rowKey={(r) => r.no}
    />
  );
}
