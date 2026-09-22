"use client";

import * as React from "react";
import { ReportView, type ReportValues } from "@/components/shared/report-view";
import type { ServerTableState } from "@/components/ui/data-table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { CHANNELS, type Job } from "@/data/mock";
import { useJobsPage, useJobSummary, useJobTypes } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { int } from "@/lib/utils";
import { daysAgo, today } from "@/lib/dates";
import { exportXlsx } from "@/lib/api";

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
  const [f, setF] = React.useState<ReportValues>({ from: daysAgo(30), to: today(), type: "", channel: "" });
  const filters = { from: f.from, to: f.to, type: f.type, channel: f.channel };
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  const pageArgs = { page: table.page, pageSize: table.pageSize, q: table.q, sort: table.sort?.key, dir: table.sort?.dir };
  // KPIs over the whole range (1 query) + one page of rows
  const { data: sum } = useJobSummary(filters);
  const { rows: JOBS, total, loading } = useJobsPage({ ...pageArgs, ...filters });
  const { data: JOB_TYPES } = useJobTypes();
  const S = sum[0];
  const newJobs = S?.fresh ?? 0;
  const days = Math.max(1, Math.round((new Date(f.to).getTime() - new Date(f.from).getTime()) / 86400000) + 1);
  const topChannel = S?.topChannel ?? "—";
  return (
    <ReportView
      title="รายงานการเปิดงานซ่อม"
      description="สรุปงานที่เปิดใหม่ในระบบตามช่วงเวลาที่กำหนด"
      filters={[
        { kind: "date", key: "from", label: "วันที่เปิดงาน (ตั้งแต่)", value: f.from },
        { kind: "date", key: "to", label: "วันที่เปิดงาน (ถึง)", value: f.to },
        { kind: "select", key: "type", label: "ประเภทงาน", options: ["ทั้งหมด", ...JOB_TYPES.map((j) => j.name)] },
        { kind: "select", key: "channel", label: "ช่องทางการขาย", options: ["ทั้งหมด", ...CHANNELS] },
      ]}
      onApply={setF}
      onExport={() => exportXlsx("jobs", { ...filters, q: table.q })}
      kpis={[
        { label: "งานที่เปิดทั้งหมด", value: int(S?.total ?? 0), tone: "primary" },
        { label: "งานใหม่ (ยังไม่เริ่ม)", value: int(newJobs), tone: "warning" },
        { label: "เฉลี่ยต่อวัน", value: ((S?.total ?? 0) / days).toFixed(1) },
        { label: "ช่องทางหลัก", value: topChannel },
      ]}
      columns={columns}
      rows={JOBS}
      loading={loading}
      rowKey={(r) => r.no}
      server={{ total, onChange: setTable }}
    />
  );
}
