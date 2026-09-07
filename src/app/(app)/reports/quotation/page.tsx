"use client";

import { ReportView } from "@/components/shared/report-view";
import { Badge } from "@/components/ui/badge";
import { type Quotation } from "@/data/mock";
import { useQuotations } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { baht, int } from "@/lib/utils";

const TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  "รอเสนอราคา": "warning",
  "เสนอราคาแล้ว": "info",
  "ลูกค้าอนุมัติ": "success",
  "ลูกค้าไม่อนุมัติ": "danger",
  "ยกเลิก": "neutral",
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
  const { data: QUOTATIONS, loading } = useQuotations();
  const approved = QUOTATIONS.filter((q) => q.status === "ลูกค้าอนุมัติ");
  const total = QUOTATIONS.reduce((s, q) => s + q.amount, 0);
  const approvedTotal = approved.reduce((s, q) => s + q.amount, 0);
  return (
    <ReportView
      title="รายงานการเสนอราคา"
      description="สรุปใบเสนอราคา อัตราการอนุมัติ และมูลค่ารวม"
      filters={[
        { kind: "date", label: "วันที่สร้าง (ตั้งแต่)", value: "2026-08-05" },
        { kind: "date", label: "วันที่สร้าง (ถึง)", value: "2026-09-04" },
        { kind: "select", label: "ประเภท", options: ["ALL", "Type A (Normal)", "Type B (VIP)"] },
        { kind: "select", label: "สถานะ", options: ["- - Select All - -", ...Object.keys(TONE)] },
      ]}
      kpis={[
        { label: "ใบเสนอราคาทั้งหมด", value: int(QUOTATIONS.length), tone: "primary" },
        { label: "ลูกค้าอนุมัติ", value: int(approved.length), tone: "success" },
        { label: "มูลค่ารวม", value: baht(total) },
        { label: "มูลค่าที่อนุมัติ", value: baht(approvedTotal), tone: "success" },
      ]}
      columns={columns}
      rows={QUOTATIONS}
      loading={loading}
      rowKey={(r) => r.no}
    />
  );
}
