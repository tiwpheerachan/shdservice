"use client";

import * as React from "react";
import { ReportView, type ReportValues } from "@/components/shared/report-view";
import type { ServerTableState } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { QUOTATION_STATUS_OPTIONS, type Quotation } from "@/data/mock";
import { useQuotationsPage, useQuotationSummary } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { baht, int } from "@/lib/utils";
import { daysAgo, today } from "@/lib/dates";
import { exportXlsx } from "@/lib/api";

const TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  "รอเสนอราคา": "warning",
  "เสนอราคาแล้ว": "info",
  "ลูกค้าตกลงซ่อม": "success",
  "ลูกค้าตกลงซ่อม รอชำระเงิน": "success",
  "ลูกค้าตกลงซ่อม รออะไหล่": "success",
  "ลูกค้าไม่ตกลงซ่อม": "danger",
  "พ้นกำหนดเสนอราคา": "danger",
  "ยกเลิกใบเสนอราคา": "neutral",
};

const columns: Column<Quotation>[] = [
  { key: "no", header: "เลขที่ใบเสนอราคา", width: "150px", cell: (r) => <span className="num font-medium">{r.no}</span> },
  { key: "date", header: "วันที่", width: "110px", cell: (r) => <span className="num text-xs">{r.date}</span> },
  { key: "type", header: "ประเภท", hideBelow: "lg", cell: (r) => <Badge tone={r.type.includes("VIP") ? "primary" : "neutral"}>{r.type}</Badge> },
  { key: "customer", header: "ลูกค้า", cell: (r) => <span className="line-clamp-1 max-w-[200px]">{r.customer}</span> },
  { key: "jobRef", header: "อ้างถึงงานซ่อม", hideBelow: "md", cell: (r) => <span className="num text-xs">{r.jobRef}</span> },
  { key: "amount", header: "จำนวนเงิน", align: "right", width: "120px", value: (r) => r.amount, cell: (r) => baht(r.amount) },
  { key: "status", header: "สถานะ", width: "150px", cell: (r) => <Badge tone={TONE[r.status] ?? "neutral"} dot>{r.status}</Badge> },
];

export default function Page() {
  const [f, setF] = React.useState<ReportValues>({ from: daysAgo(30), to: today(), type: "", status: "" });
  const filters = { from: f.from, to: f.to, status: f.status, type: f.type };
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  const pageArgs = { page: table.page, pageSize: table.pageSize, q: table.q, sort: table.sort?.key, dir: table.sort?.dir };
  const { data: sum } = useQuotationSummary(filters);
  const { rows: QUOTATIONS, total: totalRows, loading } = useQuotationsPage({ ...pageArgs, ...filters });
  const S = sum[0];
  const total = S?.amount ?? 0;
  const approvedTotal = S?.agreedAmount ?? 0;
  return (
    <ReportView
      title="รายงานการเสนอราคา"
      description="สรุปใบเสนอราคา อัตราการอนุมัติ และมูลค่ารวม"
      filters={[
        { kind: "date", key: "from", label: "วันที่สร้าง (ตั้งแต่)", value: f.from },
        { kind: "date", key: "to", label: "วันที่สร้าง (ถึง)", value: f.to },
        { kind: "select", key: "type", label: "ประเภท", options: ["ALL", "Type A (Normal)", "Type B (VIP)"] },
        { kind: "select", key: "status", label: "สถานะ", options: ["ทั้งหมด", ...QUOTATION_STATUS_OPTIONS] },
      ]}
      onApply={setF}
      onExport={() => exportXlsx("quotations", { ...filters, q: table.q })}
      kpis={[
        { label: "ใบเสนอราคาทั้งหมด", value: int(S?.total ?? 0), tone: "primary" },
        { label: "ลูกค้าตกลงซ่อม", value: int(S?.agreed ?? 0), tone: "success" },
        { label: "มูลค่ารวม", value: baht(total) },
        { label: "มูลค่าที่ตกลง", value: baht(approvedTotal), tone: "success" },
      ]}
      columns={columns}
      rows={QUOTATIONS}
      loading={loading}
      rowKey={(r) => r.no}
      server={{ total: totalRows, onChange: setTable, resetKey: JSON.stringify(f) }}
    />
  );
}
