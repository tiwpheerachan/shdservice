"use client";

import * as React from "react";
import { ReportView, type ReportValues } from "@/components/shared/report-view";
import { Badge } from "@/components/ui/badge";
import { useIssuedLines, useCategories, type IssuedLine } from "@/data/db";
import type { Column } from "@/components/ui/data-table";
import { baht, int } from "@/lib/utils";
import { daysAgo, today } from "@/lib/dates";

type Row = IssuedLine;

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
  const [f, setF] = React.useState<ReportValues>({ from: daysAgo(30), to: today(), category: "", code: "" });
  // inventory_dt lines of WHO documents (จ่ายออกตามงานซ่อม / ใบสั่งขาย / อื่นๆ)
  const { data: rows, loading } = useIssuedLines({ from: f.from, to: f.to, category: f.category, code: f.code, limit: 20000 });
  const { data: CATEGORIES } = useCategories();

  const qty = rows.reduce((s, r) => s + r.qty, 0);
  const value = rows.reduce((s, r) => s + r.value, 0);
  const top = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.code, (m.get(r.code) ?? 0) + r.qty);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  }, [rows]);
  return (
    <ReportView
      title="รายงานการเบิกจ่ายอะไหล่"
      description="อะไหล่ที่ถูกเบิกใช้ในงานซ่อมและใบสั่งขาย พร้อมมูลค่ารวม"
      filters={[
        { kind: "date", key: "from", label: "วันที่ (ตั้งแต่)", value: f.from },
        { kind: "date", key: "to", label: "วันที่ (ถึง)", value: f.to },
        { kind: "select", key: "category", label: "หมวดหมู่", options: ["- - Select All - -", ...CATEGORIES.map((c) => c.name)] },
        { kind: "text", key: "code", label: "รหัสอะไหล่", placeholder: "P02534" },
      ]}
      onApply={setF}
      kpis={[
        { label: "รายการเคลื่อนไหว", value: int(rows.length), tone: "primary" },
        { label: "จำนวนที่เบิกรวม", value: `${int(qty)} ชิ้น` },
        { label: "มูลค่ารวม", value: baht(value) },
        { label: "อะไหล่ที่ใช้บ่อยสุด", value: top },
      ]}
      columns={columns}
      rows={rows}
      loading={loading}
      rowKey={(r, i) => `${r.doc}-${r.code}-${i}`}
    />
  );
}
