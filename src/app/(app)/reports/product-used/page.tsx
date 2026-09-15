"use client";

import * as React from "react";
import { ReportView, type ReportValues } from "@/components/shared/report-view";
import type { ServerTableState } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { useIssuedLinesPage, useIssuedStats, useCategories, type IssuedLine } from "@/data/db";
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
  // inventory_dt lines of WHO documents (จ่ายออกตามงานซ่อม / ใบสั่งขาย / อื่นๆ) — paged + KPIs on the server
  const filters = { from: f.from, to: f.to, category: f.category, code: f.code };
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  const pageArgs = { page: table.page, pageSize: table.pageSize, q: table.q, sort: table.sort?.key, dir: table.sort?.dir };
  const { data: sum } = useIssuedStats(filters);
  const { rows, total, loading } = useIssuedLinesPage({ ...pageArgs, ...filters });
  const { data: CATEGORIES } = useCategories();
  const S = sum[0];
  const qty = S?.qty ?? 0;
  const value = S?.value ?? 0;
  const top = S?.top ?? "—";
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
        { label: "รายการเคลื่อนไหว", value: int(S?.lines ?? 0), tone: "primary" },
        { label: "จำนวนที่เบิกรวม", value: `${int(qty)} ชิ้น` },
        { label: "มูลค่ารวม", value: baht(value) },
        { label: "อะไหล่ที่ใช้บ่อยสุด", value: top },
      ]}
      columns={columns}
      rows={rows}
      loading={loading}
      rowKey={(r, i) => `${r.doc}-${r.code}-${i}`}
      server={{ total, onChange: setTable }}
    />
  );
}
