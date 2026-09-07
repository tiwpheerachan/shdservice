"use client";

import { ReportView } from "@/components/shared/report-view";
import { Badge } from "@/components/ui/badge";
import { type Movement } from "@/data/mock";
import { useMovements, useProducts, useCategories } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { baht, int } from "@/lib/utils";
import * as React from "react";

type Row = Movement & { code: string; item: string; qty: number; value: number };

const columns: Column<Row>[] = [
  { key: "doc", header: "Document No.", width: "130px", cell: (r) => <span className="num font-medium">{r.doc}</span> },
  { key: "date", header: "วันที่", width: "140px", cell: (r) => <span className="num text-xs">{r.date}</span> },
  { key: "type", header: "ประเภทเอกสาร", hideBelow: "lg", cell: (r) => <Badge tone="info">{r.type}</Badge> },
  { key: "code", header: "รหัสอะไหล่", width: "110px", cell: (r) => <span className="num">{r.code}</span> },
  { key: "item", header: "ชื่ออะไหล่", cell: (r) => <span className="line-clamp-1 max-w-[300px]">{r.item}</span> },
  { key: "qty", header: "จำนวน", align: "right", width: "90px", value: (r) => r.qty },
  { key: "value", header: "มูลค่า", align: "right", width: "120px", value: (r) => r.value, cell: (r) => baht(r.value) },
  { key: "by", header: "ผู้ทำรายการ", hideBelow: "xl" },
];

export default function Page() {
  const { data: MOVEMENTS, loading } = useMovements();
  const { data: PRODUCTS } = useProducts();
  const { data: CATEGORIES } = useCategories();

  const rows: Row[] = React.useMemo(() => {
    if (PRODUCTS.length === 0) return [];
    return MOVEMENTS.map((m, i) => {
      const p = PRODUCTS[i % PRODUCTS.length];
      const qty = (i % 3) + 1;
      return { ...m, code: p.sysCode, item: p.name, qty, value: qty * p.price };
    });
  }, [MOVEMENTS, PRODUCTS]);

  const qty = rows.reduce((s, r) => s + r.qty, 0);
  const value = rows.reduce((s, r) => s + r.value, 0);
  return (
    <ReportView
      title="รายงานการเบิกจ่ายอะไหล่"
      description="อะไหล่ที่ถูกเบิกใช้ในงานซ่อมและใบสั่งขาย พร้อมมูลค่ารวม"
      filters={[
        { kind: "date", label: "วันที่ (ตั้งแต่)", value: "2026-08-05" },
        { kind: "date", label: "วันที่ (ถึง)", value: "2026-09-04" },
        { kind: "select", label: "หมวดหมู่", options: ["- - Select All - -", ...CATEGORIES.map((c) => c.name)] },
        { kind: "text", label: "รหัสอะไหล่", placeholder: "P02534" },
      ]}
      kpis={[
        { label: "รายการเคลื่อนไหว", value: int(rows.length), tone: "primary" },
        { label: "จำนวนที่เบิกรวม", value: `${int(qty)} ชิ้น` },
        { label: "มูลค่ารวม", value: baht(value) },
        { label: "อะไหล่ที่ใช้บ่อยสุด", value: "P02536" },
      ]}
      columns={columns}
      rows={rows}
      loading={loading}
      rowKey={(r) => r.doc + r.code}
    />
  );
}
