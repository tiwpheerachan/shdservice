"use client";

import { ReportView, type ReportValues } from "@/components/shared/report-view";
import type { ServerTableState } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { type Product } from "@/data/mock";
import { useProductsPage, useProductStats, useCategories, useManufacturers } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { baht, int, cn } from "@/lib/utils";
import { exportXlsx } from "@/lib/api";
import * as React from "react";

type Row = Product & { value: number };

const columns: Column<Row>[] = [
  { key: "sysCode", header: "รหัส (ระบบ)", width: "110px", cell: (r) => <span className="num font-medium">{r.sysCode}</span> },
  { key: "mfgCode", header: "รหัส (ผู้ผลิต)", hideBelow: "xl", cell: (r) => <span className="num text-xs text-muted-foreground">{r.mfgCode}</span> },
  { key: "name", header: "ชื่ออะไหล่", cell: (r) => <span className="line-clamp-2 max-w-[360px]">{r.name}</span> },
  { key: "category", header: "หมวดหมู่", hideBelow: "lg" },
  { key: "brand", header: "ยี่ห้อ", hideBelow: "md", cell: (r) => <Badge tone="info">{r.brand}</Badge> },
  {
    key: "onhand",
    header: "คงเหลือ",
    align: "right",
    width: "100px",
    value: (r) => r.onhand,
    cell: (r) => (
      <span className={cn("num font-semibold", r.onhand === 0 ? "text-danger" : r.onhand <= 3 ? "text-warning" : "")}>
        {int(r.onhand)}
      </span>
    ),
  },
  { key: "price", header: "ราคา/หน่วย", align: "right", width: "110px", value: (r) => r.price, cell: (r) => baht(r.price) },
  { key: "value", header: "มูลค่าคงเหลือ", align: "right", width: "130px", value: (r) => r.value, cell: (r) => <span className="font-medium">{baht(r.value)}</span> },
];

export default function Page() {
  const { data: CATEGORIES } = useCategories();
  const { data: MANUFACTURERS } = useManufacturers();
  const [f, setF] = React.useState<ReportValues>({ category: "", brand: "", stock: "", q: "" });
  const stockKey = f.stock === "มีสินค้า" ? "in" : f.stock === "ใกล้หมด (≤3)" ? "low" : f.stock === "หมดสต๊อก" ? "out" : "";
  // ACTIVE products only; filters + KPIs on the server, table paged
  const filters = { category: f.category, brand: f.brand, stock: stockKey, status: "Active" };
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  const pageArgs = { page: table.page, pageSize: table.pageSize, q: table.q, sort: table.sort?.key, dir: table.sort?.dir };
  const { data: sum } = useProductStats({ ...filters, q: f.q });
  const { rows, total, loading } = useProductsPage({ ...pageArgs, q: table.q || f.q, ...filters });
  const S = sum[0];
  const totalValue = S?.value ?? 0;
  const totalQty = S?.qty ?? 0;
  const low = S?.low ?? 0;
  const out = S?.out ?? 0;
  return (
    <ReportView
      title="รายงานอะไหล่คงเหลือ"
      description="ยอดคงเหลือปัจจุบัน มูลค่าสต๊อก และรายการที่ต่ำกว่าจุดสั่งซื้อ"
      filters={[
        { kind: "select", key: "category", label: "หมวดหมู่", options: ["- - Select All - -", ...CATEGORIES.map((c) => c.name)] },
        { kind: "select", key: "brand", label: "ยี่ห้อ", options: ["- - Select All - -", ...MANUFACTURERS.map((m) => m.name)] },
        { kind: "select", key: "stock", label: "สถานะสต๊อก", options: ["- - Select All - -", "มีสินค้า", "ใกล้หมด (≤3)", "หมดสต๊อก"] },
        { kind: "text", key: "q", label: "รหัส / ชื่ออะไหล่", placeholder: "P02534" },
      ]}
      onApply={setF}
      onExport={() => exportXlsx("products", { ...filters, q: table.q || f.q, deleted: "active" })}
      kpis={[
        { label: "จำนวนคงเหลือรวม", value: `${int(totalQty)} ชิ้น`, tone: "primary" },
        { label: "มูลค่าสต๊อกรวม", value: baht(totalValue), tone: "success" },
        { label: "ใกล้หมด (≤ 3)", value: int(low), tone: "warning" },
        { label: "หมดสต๊อก", value: int(out), tone: "danger" },
      ]}
      columns={columns}
      rows={rows}
      loading={loading}
      rowKey={(r) => r.sysCode}
      server={{ total, onChange: setTable }}
    />
  );
}
