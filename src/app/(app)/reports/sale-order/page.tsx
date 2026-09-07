"use client";

import { ReportView } from "@/components/shared/report-view";
import { Badge } from "@/components/ui/badge";
import { type SaleOrder } from "@/data/mock";
import { useSaleOrders, useUsers } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { baht, int } from "@/lib/utils";

const TONE: Record<string, "warning" | "success" | "danger" | "info"> = {
  "รออนุมัติ": "warning",
  "อนุมัติ": "success",
  "ไม่อนุมัติ": "danger",
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
  const { data: SALE_ORDERS, loading } = useSaleOrders();
  const { data: USERS } = useUsers();
  const total = SALE_ORDERS.reduce((s, o) => s + o.amount, 0);
  const approved = SALE_ORDERS.filter((o) => o.approve === "อนุมัติ");
  const avg = SALE_ORDERS.length ? total / SALE_ORDERS.length : 0;
  return (
    <ReportView
      title="รายงานการขาย"
      description="ยอดขายตามใบสั่งขาย แยกตามพนักงานขายและช่วงเวลา"
      filters={[
        { kind: "date", label: "วันที่สั่งขาย (ตั้งแต่)", value: "2026-08-05" },
        { kind: "date", label: "วันที่สั่งขาย (ถึง)", value: "2026-09-04" },
        { kind: "select", label: "พนักงานขาย", options: ["- - Select All - -", ...USERS.map((u) => u.name)] },
        { kind: "select", label: "สถานะอนุมัติ", options: ["- - Select All - -", ...Object.keys(TONE)] },
      ]}
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
