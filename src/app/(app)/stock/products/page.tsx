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
import { SearchSelect } from "@/components/shared/search-select";
import dynamic from "next/dynamic";
import type { ProductMode } from "@/components/shared/product-detail-modal";

// 500-line modal with its own data hooks — loaded on first open, not with the list page
const ProductDetailModal = dynamic(() => import("@/components/shared/product-detail-modal").then((m) => m.ProductDetailModal), { ssr: false });
import { DataTable, type Column, type ServerTableState } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { type Product } from "@/data/mock";
import { useProductsPage, useProductStats, useManufacturers, useCategories, useModels } from "@/data/db";
import { baht, int, cn } from "@/lib/utils";
import { postJson, errMsg, exportXlsx } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

/** stock: "" = ทั้งหมด · in = มีของเกิน 3 ชิ้น · low = ใกล้หมด 1–3 · out = หมด (≤ 0) — same buckets as the KPI cards */
type StockFilter = "" | "in" | "low" | "out";
type Filters = { sysCode: string; mfgCode: string; name: string; status: string; brand: string; model: string; category: string; creator: string; date: string; stock: StockFilter };
const NO_FILTER: Filters = { sysCode: "", mfgCode: "", name: "", status: "", brand: "", model: "", category: "", creator: "", date: "", stock: "" };

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone: "primary" | "success" | "warning" | "danger";
  active?: boolean;
  onClick?: () => void;
}) {
  const map = {
    primary: "bg-primary-soft text-primary",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  };
  const ring = { primary: "ring-primary", success: "ring-success", warning: "ring-warning", danger: "ring-danger" };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? "กดอีกครั้งเพื่อยกเลิกการกรอง" : "กดเพื่อกรองรายการ"}
      className={cn(
        "surface flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-accent/40",
        active && cn("ring-2", ring[tone])
      )}
    >
      <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", map[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-2xs text-muted-foreground">{label}</p>
        <p className="num text-lg font-semibold leading-tight">{value}</p>
      </div>
    </button>
  );
}

export default function ProductsPage() {
  const { push } = useToast();
  const confirm = useConfirm();
  const { add: canAdd, edit: canEdit, del: canDel } = useAccess().forPath("/stock/products");
  const { data: MANUFACTURERS } = useManufacturers();
  const { data: CATEGORIES } = useCategories();
  const { data: MODELS } = useModels();

  const [detail, setDetail] = React.useState<{
    product: Product | null;
    mode: ProductMode;
  } | null>(null);
  // mount the (lazy) modal on first open and keep it mounted so the close animation still plays
  const [modalUsed, setModalUsed] = React.useState(false);
  React.useEffect(() => {
    if (detail) setModalUsed(true);
  }, [detail]);

  // FilterBar (applied on "ค้นหา")
  const [draft, setDraft] = React.useState<Filters>(NO_FILTER);
  const [filters, setFilters] = React.useState<Filters>({ ...NO_FILTER, status: "Active" });
  const setD = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));
  // KPI card → stock filter, applied right away and mirrored in the filter bar; same card again = clear
  const pickStock = (v: StockFilter) => {
    const next = filters.stock === v ? "" : v;
    setDraft((f) => ({ ...f, stock: next }));
    setFilters((f) => ({ ...f, stock: next }));
  };

  // server-side paging + filters (product table 2.5k rows; INACTIVE shown, DELETED hidden)
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  // cards follow the applied filters; say so once anything beyond the default (Active only) narrows the list
  const narrowed = !!table.q.trim() || JSON.stringify(filters) !== JSON.stringify({ ...NO_FILTER, status: "Active" });
  const query = React.useMemo(
    () => ({ q: table.q, ...filters }),
    [table.q, filters]
  );
  const { rows: PRODUCTS, total: totalRows, loading, refetch } = useProductsPage({
    page: table.page,
    pageSize: table.pageSize,
    sort: table.sort?.key,
    dir: table.sort?.dir,
    ...query,
  });
  const { data: statRows, refetch: refetchStats } = useProductStats(query);
  const stats = statRows[0] ?? { total: 0, qty: 0, low: 0, out: 0, value: 0 };
  const total = stats.total;
  const outOfStock = stats.out;
  const low = stats.low;
  const qty = stats.qty;
  const reload = () => {
    refetch();
    refetchStats();
  };

  // ยกเลิก = product.is_active = false (+ cancel_date / cancel_by)
  const cancelProduct = async (r: Product) => {
    if (!canDel) {
      push({ kind: "warning", title: "ยกเลิกรายการอะไหล่", desc: `${r.sysCode} — ต้องมีสิทธิ์ยกเลิก` });
      return;
    }
    const ok = await confirm({
      tone: "danger",
      title: `ยกเลิกรายการอะไหล่ ${r.sysCode}?`,
      description: (
        <>
          <span className="font-medium">{r.name}</span> จะถูกซ่อนจากรายการและตัวเลือกอะไหล่ทุกที่ ยอดคงเหลือและประวัติการเคลื่อนไหวยังอยู่ครบ
          <br />
          การกู้คืนต้องทำโดยผู้ดูแลระบบ
        </>
      ),
      confirmLabel: "ยกเลิกรายการ",
    });
    if (!ok) return;
    try {
      await postJson("/api/admin/records", { table: "products", id: r.sysCode, status: "DELETED" });
      push({ kind: "success", title: "ยกเลิกรายการอะไหล่แล้ว", desc: r.sysCode });
      reload();
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
            <Button variant="outline" size="sm" onClick={() => exportXlsx("products", { ...query, deleted: "exclude" })}>
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
        <Kpi icon={Boxes} label={narrowed ? "รายการอะไหล่ (ตามตัวกรอง)" : "รายการอะไหล่ทั้งหมด"} value={int(total)} tone="primary" active={filters.stock === ""} onClick={() => pickStock("")} />
        <Kpi icon={PackageCheck} label="จำนวนคงเหลือรวม (ชิ้น)" value={int(qty)} tone="success" active={filters.stock === "in"} onClick={() => pickStock("in")} />
        <Kpi icon={TriangleAlert} label="ใกล้หมด (≤ 3 ชิ้น)" value={int(low)} tone="warning" active={filters.stock === "low"} onClick={() => pickStock("low")} />
        <Kpi icon={PackageX} label="หมดสต๊อก" value={int(outOfStock)} tone="danger" active={filters.stock === "out"} onClick={() => pickStock("out")} />
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
      >
        <Field label="รหัสอะไหล่ (ระบบ)">
          <Input placeholder="P02534" className="num" value={draft.sysCode} onChange={(e) => setD("sysCode", e.target.value)} />
        </Field>
        <Field label="รหัสอะไหล่ (ผู้ผลิต)">
          <Input placeholder="เลข part" className="num" value={draft.mfgCode} onChange={(e) => setD("mfgCode", e.target.value)} />
        </Field>
        <Field label="ชื่ออะไหล่">
          <Input placeholder="พิมพ์บางส่วนของชื่อ" value={draft.name} onChange={(e) => setD("name", e.target.value)} />
        </Field>
        <Field label="ผู้สร้างรหัส">
          <Input placeholder="ชื่อผู้สร้าง" value={draft.creator} onChange={(e) => setD("creator", e.target.value)} />
        </Field>
        <Field label="วันที่สร้างรหัสอะไหล่">
          <Input type="date" value={draft.date} onChange={(e) => setD("date", e.target.value)} />
        </Field>
        <Field label="ยี่ห้อ (ผู้ผลิต)">
          <SearchSelect
            placeholder="ทั้งหมด" emptyLabel="ทั้งหมด"
            value={draft.brand}
            onChange={(v) => setDraft((f) => ({ ...f, brand: v, model: "" }))}
            options={MANUFACTURERS.map((m) => ({ value: m.name, label: m.name }))}
            searchPlaceholder="พิมพ์ชื่อยี่ห้อ…"
          />
        </Field>
        <Field label="รุ่น" hint="อะไหล่ที่ใช้ได้กับรุ่นนั้น (ตามที่ผูกไว้ในข้อมูลอะไหล่)">
          <SearchSelect
            placeholder="ทั้งหมด" emptyLabel="ทั้งหมด"
            value={draft.model}
            onChange={(v) => setD("model", v)}
            options={(draft.brand ? MODELS.filter((m) => m.brand === draft.brand) : MODELS).map((m) => ({ value: m.code, label: m.name, sub: m.brand || undefined }))}
            minWidth={360}
            searchPlaceholder="พิมพ์ชื่อรุ่น หรือยี่ห้อ…"
          />
        </Field>
        <Field label="สถานะอะไหล่">
          <Select value={draft.status} onChange={(e) => setD("status", e.target.value)}>
            <option value="">ทั้งหมด</option>
            <option>Active</option>
            <option>Inactive</option>
          </Select>
        </Field>
        <Field label="หมวดหมู่">
          <SearchSelect placeholder="ทั้งหมด" emptyLabel="ทั้งหมด" value={draft.category} onChange={(v) => setD("category", v)} options={CATEGORIES.map((c) => ({ value: c.name, label: c.name }))} searchPlaceholder="พิมพ์ชื่อหมวดหมู่…" />
        </Field>
        <Field label="สต๊อกคงเหลือ">
          <Select value={draft.stock} onChange={(e) => setD("stock", e.target.value as StockFilter)}>
            <option value="">ทั้งหมด</option>
            <option value="in">มีของ (เกิน 3 ชิ้น)</option>
            <option value="low">ใกล้หมด (1–3 ชิ้น)</option>
            <option value="out">หมดสต๊อก</option>
          </Select>
        </Field>
      </FilterBar>

      <DataTable searchable={false}
        columns={columns}
        rows={PRODUCTS}
        loading={loading}
        rowKey={(r) => r.sysCode}
        server={{ total: totalRows, onChange: setTable, resetKey: JSON.stringify(filters) }}
      />

      {modalUsed && <ProductDetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        product={detail?.product ?? null}
        mode={detail?.mode ?? "view"}
        onSave={() => reload()}
      />}
    </>
  );
}
