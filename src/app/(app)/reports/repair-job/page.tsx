"use client";

import * as React from "react";
import { ReportView, type ReportValues } from "@/components/shared/report-view";
import type { ServerTableState } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/badge";
import { type Job } from "@/data/mock";
import { useJobsPage, useJobSummary, useSymptoms, useStaff } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { baht, int } from "@/lib/utils";
import { daysAgo, today } from "@/lib/dates";
import { exportXlsx } from "@/lib/api";

const columns: Column<Job>[] = [
  { key: "no", header: "เลขที่งาน", width: "130px", cell: (r) => <span className="num font-medium">{r.no}</span> },
  { key: "customer", header: "ลูกค้า", cell: (r) => <span className="line-clamp-1 max-w-[200px]">{r.customer}</span> },
  { key: "brandModel", header: "ยี่ห้อ, รุ่น", hideBelow: "md" },
  { key: "imei", header: "Serial / IMEI", hideBelow: "xl", cell: (r) => <span className="num text-xs">{r.imei || r.serial}</span> },
  { key: "owner", header: "ช่างผู้รับผิดชอบ", hideBelow: "lg" },
  { key: "amount", header: "ค่าอะไหล่+บริการ", align: "right", width: "140px", value: (r) => r.amount, cell: (r) => baht(r.amount) },
  { key: "status", header: "สถานะงาน", width: "150px", cell: (r) => <StatusBadge status={r.status} /> },
];

export default function Page() {
  const [f, setF] = React.useState<ReportValues>({ from: daysAgo(30), to: today(), engineer: "", symptom: "" });
  // "วันที่ซ่อม" = job_repaired_date
  const filters = { from: f.from, to: f.to, dateBy: "repaired", engineer: f.engineer, symptom: f.symptom };
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  const pageArgs = { page: table.page, pageSize: table.pageSize, q: table.q, sort: table.sort?.key, dir: table.sort?.dir };
  const { data: sum } = useJobSummary(filters);
  const { rows: JOBS, total: totalRows, loading } = useJobsPage({ ...pageArgs, ...filters });
  const { data: SYMPTOMS } = useSymptoms();
  const { data: STAFF } = useStaff();
  const S = sum[0];
  const count = S?.total ?? 0;
  const done = S?.done ?? 0;
  const total = S?.amount ?? 0;
  const doneRate = count ? ((done / count) * 100).toFixed(1) : "0";
  return (
    <ReportView
      title="รายงานการซ่อม"
      description="รายละเอียดผลการซ่อม อะไหล่ที่ใช้ และช่างผู้รับผิดชอบ"
      filters={[
        { kind: "date", key: "from", label: "วันที่ซ่อม (ตั้งแต่)", value: f.from },
        { kind: "date", key: "to", label: "วันที่ซ่อม (ถึง)", value: f.to },
        { kind: "select", key: "engineer", label: "ช่างผู้รับผิดชอบ", options: ["ทั้งหมด", ...STAFF.map((s) => s.name)] },
        { kind: "select", key: "symptom", label: "อาการเสีย", options: ["ทั้งหมด", ...SYMPTOMS.map((s) => s.name)] },
      ]}
      onApply={setF}
      onExport={() => exportXlsx("jobs", { ...filters, q: table.q })}
      kpis={[
        { label: "งานที่ดำเนินการ", value: int(count), tone: "primary" },
        { label: "ซ่อมสำเร็จ", value: int(done), tone: "success" },
        { label: "มูลค่างานซ่อมรวม", value: baht(total) },
        { label: "อัตราซ่อมสำเร็จ", value: `${doneRate}%`, tone: "success" },
      ]}
      columns={columns}
      rows={JOBS}
      loading={loading}
      rowKey={(r) => r.no}
      server={{ total: totalRows, onChange: setTable, resetKey: JSON.stringify(f) }}
    />
  );
}
