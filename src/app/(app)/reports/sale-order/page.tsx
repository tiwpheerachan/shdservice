"use client";

import * as React from "react";
import { ReportView, type ReportValues } from "@/components/shared/report-view";
import { Badge } from "@/components/ui/badge";
import { type SaleOrder } from "@/data/mock";
import { useSaleOrders, useStaff } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { baht, int } from "@/lib/utils";
import { daysAgo, today } from "@/lib/dates";

const TONE: Record<string, "warning" | "success" | "danger" | "info"> = {
  "รออนุมัติ": "warning",
  "อนุมัติแล้ว": "success",
  "ปฏิเสธ": "danger",
  "แก้ไขข้อมูล": "danger",
  "กำลังดำเนินการจัดทำ": "info",
};

const columns: Column<SaleOrder>[] = [
  { key: "no", header: "SO No.", width: "120px", cell: (r) => <span className="num font-medium">{r.no}</span> },
  { key: "date", header: "วันที่สั่ง", width: "110px", cell: (r) => <span className="num text-xs">{r.date}</span> },
  { key: "customer", header: "ชื่อลูกค้า", cell: (r) => <span className="line-clamp-1 max-w-[240px]">{r.customer}</span> },
  { key: "sales", header: "พนักงานขาย", hideBelow: "md" },
  { key: "amount", header: "จำนวนเงิน", align: "right", width: "120px", value: (r) => r.amount, cell: (r) => baht(r.amount) },
  { key: "approve", header: "สถานะอนุมัติ", width: "170px", cell: (r) => <Badge tone={TONE[r.approve] ?? "neutral"} dot>{r.approve}</Badge> },
  { key: "tracking", header: "TrackingNo", hideBelow: "xl", cell: (r) => <span className="num text-xs">{r.tracking || "—"}</span> },
];

export default function Page() {
  const [f, setF] = React.useState<ReportValues>({ from: daysAgo(30), to: today(), sales: "", approve: "" });
  const { data: STAFF } = useStaff();
  const salesId = STAFF.find((s) => s.name === f.sales)?.id;
  const { data: SALE_ORDERS, loading } = useSaleOrders({ from: f.from, to: f.to, sales: salesId ?? f.sales, approve: f.approve, limit: 20000 });
  const total = SALE_ORDERS.reduce((s, o) => s + o.amount, 0);
  const approved = SALE_ORDERS.filter((o) => o.approve === "อนุมัติแล้ว");
  const avg = SALE_ORDERS.length ? total / SALE_ORDERS.length : 0;
  return (
    <ReportView
      title="รายงานการขาย"
      description="ยอดขายตามใบสั่งขาย แยกตามพนักงานขายและช่วงเวลา"
      filters={[
        { kind: "date", key: "from", label: "วันที่สั่งขาย (ตั้งแต่)", value: f.from },
        { kind: "date", key: "to", label: "วันที่สั่งขาย (ถึง)", value: f.to },
        { kind: "select", key: "sales", label: "พนักงานขาย", options: ["- - Select All - -", ...STAFF.map((u) => u.name)] },
        { kind: "select", key: "approve", label: "สถานะอนุมัติ", options: ["- - Select All - -", ...Object.keys(TONE)] },
      ]}
      onApply={setF}
      kpis={[
        { label: "ใบสั่งขายทั้งหมด", value: int(SALE_ORDERS.length), tone: "primary" },
        { label: "อนุมัติแล้ว", value: int(approved.length), tone: "success" },
        { label: "ยอดขายรวม", value: baht(total) },
        { label: "ยอดเฉลี่ย/ใบ", value: baht(avg) },
      ]}
      columns={columns}
      rows={SALE_ORDERS}
      loading={loading}
      rowKey={(r) => r.no}
    />
  );
}
