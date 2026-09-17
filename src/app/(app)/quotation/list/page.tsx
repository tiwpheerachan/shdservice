"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Download, Printer } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column, type ServerTableState } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { WARRANTY_OPTIONS, QUOTATION_STATUS_OPTIONS, type Quotation } from "@/data/mock";
import { useQuotationsPage, useManufacturers } from "@/data/db";
import { baht } from "@/lib/utils";
import { useAccess } from "@/lib/use-access";
import { exportXlsx } from "@/lib/api";

// quotation_status names (DB) → badge tone
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

type Filters = { no: string; type: string; customer: string; customerCode: string; jobNo: string; imei: string; warranty: string; brand: string; from: string; to: string; status: string };
const NO_FILTER: Filters = { no: "", type: "", customer: "", customerCode: "", jobNo: "", imei: "", warranty: "", brand: "", from: "", to: "", status: "" };

export default function QuotationListPage() {
  const { push } = useToast();
  const { add: canAdd, edit: canEdit } = useAccess().forPath("/quotation/list");
  const { data: MANUFACTURERS } = useManufacturers();
  const [draft, setDraft] = React.useState<Filters>(NO_FILTER);
  const [filters, setFilters] = React.useState<Filters>(NO_FILTER);
  const setD = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  const { rows: PAGE, total: totalRows, loading } = useQuotationsPage({
    page: table.page,
    pageSize: table.pageSize,
    q: table.q || filters.no || filters.customer || filters.customerCode || filters.jobNo || filters.imei,
    sort: table.sort?.key,
    dir: table.sort?.dir,
    status: filters.status,
    from: filters.from,
    to: filters.to,
    type: filters.type,
    warranty: filters.warranty,
    brand: filters.brand,
  });
  const QUOTATIONS = PAGE;

  const columns: Column<Quotation>[] = [
    {
      key: "no",
      header: "หมายเลขใบเสนอราคา",
      width: "150px",
      cell: (r) => (
        <Link href={`/quotation/edit?no=${encodeURIComponent(r.no)}`} className="num font-medium text-primary hover:underline">
          {r.no}
        </Link>
      ),
    },
    {
      key: "date",
      header: "วันที่",
      width: "110px",
      cell: (r) => <span className="num text-xs">{r.date}</span>,
    },
    {
      key: "type",
      header: "ประเภท",
      width: "130px",
      hideBelow: "lg",
      cell: (r) => (
        <Badge tone={r.type.includes("VIP") ? "primary" : "neutral"}>{r.type}</Badge>
      ),
    },
    {
      key: "customer",
      header: "ลูกค้า",
      cell: (r) => <span className="line-clamp-1 max-w-[220px]">{r.customer}</span>,
    },
    {
      key: "jobRef",
      header: "อ้างถึงงานซ่อม",
      width: "130px",
      cell: (r) => <span className="num text-xs">{r.jobRef}</span>,
    },
    {
      key: "imei",
      header: "IMEI No.",
      hideBelow: "xl",
      cell: (r) => <span className="num text-xs">{r.imei}</span>,
    },
    { key: "brandModel", header: "ยี่ห้อ, รุ่น", hideBelow: "md" },
    {
      key: "amount",
      header: "จำนวนเงิน",
      align: "right",
      width: "120px",
      value: (r) => r.amount,
      cell: (r) => <span className="font-medium">{baht(r.amount)}</span>,
    },
    {
      key: "approveDate",
      header: "วันที่ตอบรับ",
      hideBelow: "xl",
      width: "130px",
      cell: (r) => <span className="num text-xs">{r.approveDate || "—"}</span>,
    },
    {
      key: "status",
      header: "สถานะ",
      width: "140px",
      cell: (r) => (
        <Badge tone={TONE[r.status] ?? "neutral"} dot>
          {r.status}
        </Badge>
      ),
    },
    {
      key: "action",
      header: "Action",
      width: "110px",
      align: "center",
      sortable: false,
      cell: (r) => (
        <RowActions
          onView={() => (window.location.href = `/quotation/edit?no=${encodeURIComponent(r.no)}`)}
          onEdit={canEdit ? () => (window.location.href = `/quotation/edit?no=${encodeURIComponent(r.no)}`) : undefined}
        />
      ),
    },
  ];

  const total = QUOTATIONS.reduce((s, q) => s + q.amount, 0);

  return (
    <>
      <PageHeader
        title="รายการใบเสนอราคา"
        description="ข้อมูลใบเสนอราคา » ข้อมูลใบเสนอราคาทั้งหมด"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              พิมพ์
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportXlsx("quotations", { q: table.q || filters.no || filters.customer || filters.customerCode || filters.jobNo || filters.imei, status: filters.status, from: filters.from, to: filters.to, type: filters.type, warranty: filters.warranty, brand: filters.brand })}>
              <Download className="h-3.5 w-3.5" />
              ส่งออก Excel
            </Button>
            {canAdd && (
              <Link href="/quotation/new">
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  สร้างใบเสนอราคา
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
        defaultOpen={false}
      >
        <Field label="หมายเลขใบเสนอราคา">
          <Input className="num" placeholder="Q2600462" value={draft.no} onChange={(e) => setD("no", e.target.value)} />
        </Field>
        <Field label="ประเภท">
          <Select value={draft.type} onChange={(e) => setD("type", e.target.value)}>
            <option value="">ALL</option>
            <option>Type A (Normal)</option>
            <option>Type B (VIP)</option>
          </Select>
        </Field>
        <Field label="ชื่อ-สกุลลูกค้า">
          <Input value={draft.customer} onChange={(e) => setD("customer", e.target.value)} />
        </Field>
        <Field label="รหัสลูกค้า">
          <Input className="num" value={draft.customerCode} onChange={(e) => setD("customerCode", e.target.value)} />
        </Field>
        <Field label="หมายเลขงานซ่อม">
          <Input className="num" value={draft.jobNo} onChange={(e) => setD("jobNo", e.target.value)} />
        </Field>
        <Field label="IMEI No.">
          <Input className="num" value={draft.imei} onChange={(e) => setD("imei", e.target.value)} />
        </Field>
        <Field label="Warranty">
          <Select value={draft.warranty} onChange={(e) => setD("warranty", e.target.value)}>
            <option value="">- - Select All - -</option>
            {WARRANTY_OPTIONS.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </Select>
        </Field>
        <Field label="ยี่ห้อ">
          <Select value={draft.brand} onChange={(e) => setD("brand", e.target.value)}>
            <option value="">- - Select All - -</option>
            {MANUFACTURERS.map((m) => (
              <option key={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="วันที่สร้าง (ตั้งแต่)">
          <Input type="date" value={draft.from} onChange={(e) => setD("from", e.target.value)} />
        </Field>
        <Field label="วันที่สร้าง (ถึง)">
          <Input type="date" value={draft.to} onChange={(e) => setD("to", e.target.value)} />
        </Field>
        <Field label="สถานะใบเสนอราคา">
          <Select value={draft.status} onChange={(e) => setD("status", e.target.value)}>
            <option value="">- - Select ALL - -</option>
            {QUOTATION_STATUS_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={QUOTATIONS}
        loading={loading}
        rowKey={(r) => r.no}
        searchPlaceholder="ค้นหาเลขที่ใบเสนอราคา / ลูกค้า / งานซ่อม…"
        footerNote={
          <span className="font-medium text-foreground">· มูลค่ารวม (หน้านี้) {baht(total)} ฿</span>
        }
        server={{ total: totalRows, onChange: setTable }}
      />
    </>
  );
}
