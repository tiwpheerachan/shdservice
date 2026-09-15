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
import { postJson, errMsg } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

type Filters = { sysCode: string; mfgCode: string; name: string; status: string; brand: string; category: string; creator: string; date: string };
const NO_FILTER: Filters = { sysCode: "", mfgCode: "", name: "", status: "", brand: "", category: "", creator: "", date: "" };

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
  const { add: canAdd, edit: canEdit, del: canDel } = useAccess().forPath("/stock/products");
  // inactive parts are included so the "สถานะ" filter can show them
  const { data: ALL, loading, refetch } = useProducts({ deleted: "all" });
  const { data: MANUFACTURERS } = useManufacturers();
  const { data: CATEGORIES } = useCategories();

  const [detail, setDetail] = React.useState<{
    product: Product | null;
    mode: ProductMode;
  } | null>(null);

  // FilterBar (applied on "ค้นหา")
  const [draft, setDraft] = React.useState<Filters>(NO_FILTER);
  const [filters, setFilters] = React.useState<Filters>({ ...NO_FILTER, status: "Active" });
  const setD = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));

  const PRODUCTS = React.useMemo(
    () =>
      ALL.filter(
        (p) =>
          (!filters.status || p.status === filters.status) &&
          (!filters.sysCode || p.sysCode.toLowerCase().includes(filters.sysCode.toLowerCase())) &&
          (!filters.mfgCode || p.mfgCode.toLowerCase().includes(filters.mfgCode.toLowerCase())) &&
          (!filters.name || p.name.toLowerCase().includes(filters.name.toLowerCase())) &&
          (!filters.brand || p.brand === filters.brand) &&
          (!filters.category || p.category === filters.category) &&
          (!filters.creator || (p.createdBy ?? "").toLowerCase().includes(filters.creator.toLowerCase())) &&
          (!filters.date || (p.createdDate ?? "").startsWith(filters.date))
      ),
    [ALL, filters]
  );

  const total = PRODUCTS.length;
  const outOfStock = PRODUCTS.filter((p) => p.onhand <= 0).length;
  const low = PRODUCTS.filter((p) => p.onhand > 0 && p.onhand <= 3).length;
  const qty = PRODUCTS.reduce((s, p) => s + Math.max(0, p.onhand), 0);

  // ยกเลิก = product.is_active = false (+ cancel_date / cancel_by)
  const cancelProduct = async (r: Product) => {
    if (!canDel) {
      push({ kind: "warning", title: "ยกเลิกรายการอะไหล่", desc: `${r.sysCode} — ต้องมีสิทธิ์ยกเลิก` });
      return;
    }
    if (!window.confirm(`ยกเลิกรายการอะไหล่ ${r.sysCode} — ${r.name}?`)) return;
    try {
      await postJson("/api/admin/records", { table: "products", id: r.sysCode, deleted: true });
      push({ kind: "success", title: "ยกเลิกรายการอะไหล่แล้ว", desc: r.sysCode });
      refetch();
    } catch (e) {
      push({ kind: "error", title: "ยกเลิกไม่สำเร็จ", desc: errMsg(e) });
    }
  };

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
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDetail({ product: r, mode: "edit" })}
            >
              <Pencil className="h-3.5 w-3.5" />
              แก้ไข
            </Button>
          )}
          {canDel && r.status === "Active" && (
            <Button
              size="sm"
              variant="outline"
              className="text-danger hover:bg-danger-soft"
              onClick={() => cancelProduct(r)}
            >
              <Ban className="h-3.5 w-3.5" />
              ยกเลิก
            </Button>
          )}
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
            {canAdd && (
              <Button size="sm" onClick={() => setDetail({ product: null, mode: "add" })}>
                <Plus className="h-3.5 w-3.5" />
                เพิ่มอะไหล่
              </Button>
            )}
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
        onSearch={() => {
          setFilters(draft);
          push({ kind: "info", title: "กรองข้อมูลตามเงื่อนไขแล้ว" });
        }}
        onReset={() => {
          setDraft(NO_FILTER);
          setFilters({ ...NO_FILTER, status: "Active" });
        }}
        defaultOpen={false}
      >
        <Field label="รหัสอะไหล่ (ระบบ)">
          <Input placeholder="P02534" className="num" value={draft.sysCode} onChange={(e) => setD("sysCode", e.target.value)} />
        </Field>
        <Field label="รหัสอะไหล่ (ผู้ผลิต)">
          <Input className="num" value={draft.mfgCode} onChange={(e) => setD("mfgCode", e.target.value)} />
        </Field>
        <Field label="ชื่ออะไหล่">
          <Input placeholder="ชื่ออะไหล่…" value={draft.name} onChange={(e) => setD("name", e.target.value)} />
        </Field>
        <Field label="สถานะอะไหล่">
          <Select value={draft.status} onChange={(e) => setD("status", e.target.value)}>
            <option value="">- - Select All - -</option>
            <option>Active</option>
            <option>Inactive</option>
          </Select>
        </Field>
        <Field label="ยี่ห้อ (ผู้ผลิต)">
          <Select value={draft.brand} onChange={(e) => setD("brand", e.target.value)}>
            <option value="">- - Select All - -</option>
            {MANUFACTURERS.map((m) => (
              <option key={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="หมวดหมู่">
          <Select value={draft.category} onChange={(e) => setD("category", e.target.value)}>
            <option value="">- - Select All - -</option>
            {CATEGORIES.map((c) => (
              <option key={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="ผู้สร้างรหัส">
          <Input placeholder="ชื่อผู้สร้าง" value={draft.creator} onChange={(e) => setD("creator", e.target.value)} />
        </Field>
        <Field label="วันที่สร้างรหัสอะไหล่">
          <Input type="date" value={draft.date} onChange={(e) => setD("date", e.target.value)} />
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
        onSave={() => refetch()}
      />
    </>
  );
}
