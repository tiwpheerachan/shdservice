"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Download, Printer } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { WARRANTY_OPTIONS, type Quotation } from "@/data/mock";
import { useQuotations, useManufacturers } from "@/data/db";
import { baht } from "@/lib/utils";

const TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  "รอเสนอราคา": "warning",
  "เสนอราคาแล้ว": "info",
  "ลูกค้าอนุมัติ": "success",
  "ลูกค้าไม่อนุมัติ": "danger",
  "ยกเลิก": "neutral",
};

export default function QuotationListPage() {
  const { push } = useToast();
  const { data: QUOTATIONS, loading } = useQuotations();
  const { data: MANUFACTURERS } = useManufacturers();

  const columns: Column<Quotation>[] = [
    {
      key: "no",
      header: "หมายเลขใบเสนอราคา",
      width: "150px",
      cell: (r) => (
        <Link href="/quotation/edit" className="num font-medium text-primary hover:underline">
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
          onView={() => push({ kind: "info", title: r.no, desc: r.customer })}
          onEdit={() => push({ kind: "info", title: "แก้ไขใบเสนอราคา", desc: r.no })}
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
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" />
              ส่งออก Excel
            </Button>
            <Link href="/quotation/new">
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" />
                สร้างใบเสนอราคา
              </Button>
            </Link>
          </>
        }
      />

      <FilterBar onSearch={() => push({ kind: "info", title: "กรองข้อมูลแล้ว" })} defaultOpen={false}>
        <Field label="หมายเลขใบเสนอราคา">
          <Input className="num" placeholder="QT2601200" />
        </Field>
        <Field label="ประเภท">
          <Select>
            <option>ALL</option>
            <option>Type A (Normal)</option>
            <option>Type B (VIP)</option>
          </Select>
        </Field>
        <Field label="ชื่อ-สกุลลูกค้า">
          <Input />
        </Field>
        <Field label="รหัสลูกค้า">
          <Input className="num" />
        </Field>
        <Field label="หมายเลขงานซ่อม">
          <Input className="num" />
        </Field>
        <Field label="IMEI No.">
          <Input className="num" />
        </Field>
        <Field label="Warranty">
          <Select>
            <option>- - Select All - -</option>
            {WARRANTY_OPTIONS.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </Select>
        </Field>
        <Field label="ยี่ห้อ">
          <Select>
            <option>- - Select All - -</option>
            {MANUFACTURERS.map((m) => (
              <option key={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="วันที่สร้าง (ตั้งแต่)">
          <Input type="date" defaultValue="2026-08-05" />
        </Field>
        <Field label="วันที่สร้าง (ถึง)">
          <Input type="date" defaultValue="2026-09-04" />
        </Field>
        <Field label="สถานะใบเสนอราคา">
          <Select>
            <option>- - Select ALL - -</option>
            {Object.keys(TONE).map((s) => (
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
          <span className="font-medium text-foreground">· มูลค่ารวม {baht(total)} ฿</span>
        }
      />
    </>
  );
}
