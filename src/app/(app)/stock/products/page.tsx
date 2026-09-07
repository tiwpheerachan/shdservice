"use client";

import * as React from "react";
import {
  Plus,
  Download,
  PackageX,
  TriangleAlert,
  Boxes,
  PackageCheck,
  Eye,
  Pencil,
  Ban,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { ProductDetailModal, type ProductMode } from "@/components/shared/product-detail-modal";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type Product } from "@/data/mock";
import { useProducts, useManufacturers, useCategories } from "@/data/db";
import { baht, int, cn } from "@/lib/utils";

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone: "primary" | "success" | "warning" | "danger";
}) {
  const map = {
    primary: "bg-primary-soft text-primary",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <div className="surface flex items-center gap-3 p-3.5">
      <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", map[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-2xs text-muted-foreground">{label}</p>
        <p className="num text-lg font-semibold leading-tight">{value}</p>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const { push } = useToast();
  const { data: PRODUCTS, loading } = useProducts();
  const { data: MANUFACTURERS } = useManufacturers();
  const { data: CATEGORIES } = useCategories();

  const [detail, setDetail] = React.useState<{
    product: Product;
    mode: ProductMode;
  } | null>(null);

  const total = PRODUCTS.length;
  const outOfStock = PRODUCTS.filter((p) => p.onhand === 0).length;
  const low = PRODUCTS.filter((p) => p.onhand > 0 && p.onhand <= 3).length;
  const qty = PRODUCTS.reduce((s, p) => s + p.onhand, 0);

  const columns: Column<Product>[] = [
    {
      key: "no",
      header: "#",
      width: "52px",
      align: "center",
      sortable: false,
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: "sysCode",
      header: "รหัส (ระบบ)",
      width: "100px",
      cell: (r) => <span className="num font-medium">{r.sysCode}</span>,
    },
    {
      key: "mfgCode",
      header: "รหัส (ผู้ผลิต)",
      hideBelow: "lg",
      cell: (r) => <span className="num text-xs text-muted-foreground">{r.mfgCode}</span>,
    },
    {
      key: "name",
      header: "ชื่ออะไหล่",
      cell: (r) => (
        <span className="line-clamp-2 max-w-[420px] font-medium">{r.name}</span>
      ),
    },
    { key: "category", header: "หมวดหมู่", hideBelow: "xl" },
    {
      key: "brand",
      header: "ยี่ห้อ (ผู้ผลิต)",
      hideBelow: "md",
      cell: (r) => <Badge tone="info">{r.brand}</Badge>,
    },
    {
      key: "onhand",
      header: "คงเหลือ (พร้อมใช้)",
      align: "right",
      width: "130px",
      value: (r) => r.onhand,
      cell: (r) => (
        <span
          className={cn(
            "num font-semibold",
            r.onhand === 0
              ? "text-danger"
              : r.onhand <= 3
                ? "text-warning"
                : "text-foreground"
          )}
        >
          {int(r.onhand)}
        </span>
      ),
    },
    {
      key: "price",
      header: "ราคาขาย",
      align: "right",
      width: "110px",
      value: (r) => r.price,
      cell: (r) => baht(r.price),
    },
    {
      key: "status",
      header: "สถานะ",
      width: "100px",
      cell: (r) => (
        <Badge tone={r.status === "Active" ? "success" : "neutral"} dot>
          {r.status}
        </Badge>
      ),
    },
    {
      key: "action",
      header: "Action",
      width: "220px",
      align: "center",
      sortable: false,
      cell: (r) => (
        <div className="flex items-center justify-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDetail({ product: r, mode: "view" })}
          >
            <Eye className="h-3.5 w-3.5" />
            View
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDetail({ product: r, mode: "edit" })}
          >
            <Pencil className="h-3.5 w-3.5" />
            แก้ไข
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-danger hover:bg-danger-soft"
            onClick={() =>
              push({
                kind: "warning",
                title: "ยกเลิกรายการอะไหล่",
                desc: `${r.sysCode} — ต้องมีสิทธิ์ยกเลิก (ระบบสาธิต)`,
              })
            }
          >
            <Ban className="h-3.5 w-3.5" />
            ยกเลิก
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="รายการอะไหล่ทั้งหมด"
        description="ทะเบียนอะไหล่และอุปกรณ์เสริม พร้อมยอดคงเหลือที่พร้อมใช้งาน"
        actions={
          <>
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" />
              ส่งออก Excel
            </Button>
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              เพิ่มอะไหล่
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Boxes} label="รายการอะไหล่ทั้งหมด" value={int(total)} tone="primary" />
        <Kpi icon={PackageCheck} label="จำนวนคงเหลือรวม (ชิ้น)" value={int(qty)} tone="success" />
        <Kpi icon={TriangleAlert} label="ใกล้หมด (≤ 3 ชิ้น)" value={int(low)} tone="warning" />
        <Kpi icon={PackageX} label="หมดสต๊อก" value={int(outOfStock)} tone="danger" />
      </div>

      <FilterBar
        onSearch={() => push({ kind: "info", title: "กรองข้อมูลตามเงื่อนไขแล้ว" })}
        defaultOpen={false}
      >
        <Field label="รหัสอะไหล่ (ระบบ)">
          <Input placeholder="P02534" className="num" />
        </Field>
        <Field label="รหัสอะไหล่ (ผู้ผลิต)">
          <Input className="num" />
        </Field>
        <Field label="ชื่ออะไหล่">
          <Input placeholder="ชื่ออะไหล่…" />
        </Field>
        <Field label="สถานะอะไหล่">
          <Select>
            <option>- - Select All - -</option>
            <option>Active</option>
            <option>Inactive</option>
          </Select>
        </Field>
        <Field label="ยี่ห้อ (ผู้ผลิต)">
          <Select>
            <option>- - Select All - -</option>
            {MANUFACTURERS.map((m) => (
              <option key={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="หมวดหมู่">
          <Select>
            <option>- - Select All - -</option>
            {CATEGORIES.map((c) => (
              <option key={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="ผู้สร้างรหัส">
          <Input placeholder="ชื่อผู้สร้าง" />
        </Field>
        <Field label="วันที่สร้างรหัสอะไหล่">
          <Input type="date" />
        </Field>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={PRODUCTS}
        loading={loading}
        rowKey={(r) => r.sysCode}
        searchPlaceholder="ค้นหารหัส / ชื่ออะไหล่ / ยี่ห้อ…"
      />

      <ProductDetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        product={detail?.product ?? null}
        mode={detail?.mode ?? "view"}
      />
    </>
  );
}
