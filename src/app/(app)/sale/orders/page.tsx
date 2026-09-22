"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column, type ServerTableState } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type SaleOrder } from "@/data/mock";
import { useSaleOrdersPage, useStaff } from "@/data/db";
import { baht } from "@/lib/utils";
import { useAccess } from "@/lib/use-access";
import { exportXlsx } from "@/lib/api";

// approve_status.approve_name_th → badge tone
const TONE: Record<string, "warning" | "success" | "danger" | "info"> = {
  "รออนุมัติ": "warning",
  "อนุมัติแล้ว": "success",
  "ปฏิเสธ": "danger",
  "แก้ไขข้อมูล": "danger",
  "กำลังดำเนินการจัดทำ": "info",
};

type Filters = { no: string; customer: string; from: string; to: string; code: string; sales: string; approve: string };
const NO_FILTER: Filters = { no: "", customer: "", from: "", to: "", code: "", sales: "", approve: "" };

export default function SaleOrderPage() {
  const { push } = useToast();
  const { add: canAdd, edit: canEdit } = useAccess().forPath("/sale/orders");
  const { data: USERS } = useStaff();
  const [draft, setDraft] = React.useState<Filters>(NO_FILTER);
  const [filters, setFilters] = React.useState<Filters>(NO_FILTER);
  const setD = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  const { rows: SALE_ORDERS, total, loading } = useSaleOrdersPage({
    page: table.page,
    pageSize: table.pageSize,
    q: table.q || filters.no || filters.customer || filters.code,
    sort: table.sort?.key,
    dir: table.sort?.dir,
    from: filters.from,
    to: filters.to,
    sales: filters.sales,
    approve: filters.approve,
  });

  const columns: Column<SaleOrder>[] = [
    {
      key: "no",
      header: "SO No.",
      width: "120px",
      cell: (r) => (
        <Link href={`/sale/orders/edit?no=${encodeURIComponent(r.no)}`} className="num font-medium text-primary hover:underline">
          {r.no}
        </Link>
      ),
    },
    {
      key: "date",
      header: "วันที่สั่ง",
      width: "110px",
      cell: (r) => <span className="num text-xs">{r.date}</span>,
    },
    {
      key: "customer",
      header: "ชื่อลูกค้า",
      cell: (r) => <span className="line-clamp-1 max-w-[260px]">{r.customer}</span>,
    },
    {
      key: "amount",
      header: "จำนวนเงิน",
      align: "right",
      width: "120px",
      value: (r) => r.amount,
      cell: (r) => <span className="font-medium">{baht(r.amount)}</span>,
    },
    { key: "sales", header: "พนักงานขาย", hideBelow: "md" },
    {
      key: "approve",
      header: "สถานะอนุมัติ",
      width: "160px",
      cell: (r) => (
        <Badge tone={TONE[r.approve] ?? "neutral"} dot>
          {r.approve}
        </Badge>
      ),
    },
    {
      key: "stockDoc",
      header: "เลขจ่ายสต๊อก",
      hideBelow: "xl",
      cell: (r) => <span className="num text-xs">{r.stockDoc || "—"}</span>,
    },
    {
      key: "tracking",
      header: "TrackingNo",
      hideBelow: "xl",
      cell: (r) => <span className="num text-xs">{r.tracking || "—"}</span>,
    },
    {
      key: "action",
      header: "Action",
      width: "110px",
      align: "center",
      sortable: false,
      cell: (r) => (
        <RowActions
          onView={() => (window.location.href = `/sale/orders/edit?no=${encodeURIComponent(r.no)}`)}
          onEdit={canEdit ? () => (window.location.href = `/sale/orders/edit?no=${encodeURIComponent(r.no)}`) : undefined}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="รายการใบสั่งขาย"
        description="เมนูขาย » ใบสั่งขาย (Sale Order)"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => exportXlsx("sale_orders", { q: table.q || filters.no || filters.customer || filters.code, from: filters.from, to: filters.to, sales: filters.sales, approve: filters.approve })}>
              <Download className="h-3.5 w-3.5" />
              ส่งออก Excel
            </Button>
            {canAdd && (
              <Link href="/sale/orders/new">
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  สร้างใบสั่งขาย
                </Button>
              </Link>
            )}
          </>
        }
      />

      <FilterBar
        onSearch={() => {
          setFilters(draft);
          push({ kind: "info", title: "กรองข้อมูลแล้ว" });
        }}
        onReset={() => {
          setDraft(NO_FILTER);
          setFilters(NO_FILTER);
        }}
      >
        <Field label="เลขใบสั่งขาย (SO)">
          <Input className="num" placeholder="SO2600760" value={draft.no} onChange={(e) => setD("no", e.target.value)} />
        </Field>
        <Field label="ชื่อลูกค้า">
          <Input value={draft.customer} onChange={(e) => setD("customer", e.target.value)} />
        </Field>
        <Field label="วันที่สั่งขาย (ตั้งแต่)">
          <Input type="date" value={draft.from} onChange={(e) => setD("from", e.target.value)} />
        </Field>
        <Field label="วันที่สั่งขาย (ถึง)">
          <Input type="date" value={draft.to} onChange={(e) => setD("to", e.target.value)} />
        </Field>
        <Field label="รหัสอะไหล่-อุปกรณ์เสริม">
          <Input className="num" value={draft.code} onChange={(e) => setD("code", e.target.value)} />
        </Field>
        <Field label="พนักงานขาย">
          <Select value={draft.sales} onChange={(e) => setD("sales", e.target.value)}>
            <option value="">ทั้งหมด</option>
            {USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="สถานะการอนุมัติ">
          <Select value={draft.approve} onChange={(e) => setD("approve", e.target.value)}>
            <option value="">ทั้งหมด</option>
            {Object.keys(TONE).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      <DataTable searchable={false}
        columns={columns}
        rows={SALE_ORDERS}
        loading={loading}
        rowKey={(r) => r.no}
        server={{ total, onChange: setTable }}
      />
    </>
  );
}
