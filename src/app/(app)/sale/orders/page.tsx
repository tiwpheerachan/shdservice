"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type SaleOrder } from "@/data/mock";
import { useSaleOrders, useUsers } from "@/data/db";
import { baht } from "@/lib/utils";

const TONE: Record<string, "warning" | "success" | "danger" | "info"> = {
  "รออนุมัติ": "warning",
  "อนุมัติ": "success",
  "ไม่อนุมัติ": "danger",
  "กำลังดำเนินการจัดทำ": "info",
};

export default function SaleOrderPage() {
  const { push } = useToast();
  const { data: SALE_ORDERS, loading } = useSaleOrders();
  const { data: USERS } = useUsers();

  const columns: Column<SaleOrder>[] = [
    {
      key: "no",
      header: "SO No.",
      width: "120px",
      cell: (r) => (
        <Link href="/sale/orders/edit" className="num font-medium text-primary hover:underline">
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
          onView={() => push({ kind: "info", title: r.no, desc: r.customer })}
          onEdit={() => push({ kind: "info", title: "แก้ไขใบสั่งขาย", desc: r.no })}
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
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" />
              ส่งออก Excel
            </Button>
            <Link href="/sale/orders/new">
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" />
                สร้างใบสั่งขาย
              </Button>
            </Link>
          </>
        }
      />

      <FilterBar onSearch={() => push({ kind: "info", title: "กรองข้อมูลแล้ว" })} defaultOpen={false}>
        <Field label="เลขใบสั่งขาย (SO)">
          <Input className="num" placeholder="SO2600727" />
        </Field>
        <Field label="ชื่อลูกค้า">
          <Input />
        </Field>
        <Field label="วันที่สั่งขาย (ตั้งแต่)">
          <Input type="date" defaultValue="2026-08-05" />
        </Field>
        <Field label="วันที่สั่งขาย (ถึง)">
          <Input type="date" defaultValue="2026-09-04" />
        </Field>
        <Field label="รหัสอะไหล่-อุปกรณ์เสริม">
          <Input className="num" />
        </Field>
        <Field label="พนักงานขาย">
          <Select>
            <option>- - Select All - -</option>
            {USERS.map((u) => (
              <option key={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="สถานะการอนุมัติ">
          <Select>
            <option>- - Select All - -</option>
            {Object.keys(TONE).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={SALE_ORDERS}
        loading={loading}
        rowKey={(r) => r.no}
        searchPlaceholder="ค้นหา SO / ลูกค้า / พนักงานขาย…"
      />
    </>
  );
}
