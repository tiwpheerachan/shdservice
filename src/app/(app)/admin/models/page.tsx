"use client";

import * as React from "react";
import { Plus, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { SearchSelect, strOptions } from "@/components/shared/search-select";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column, type ServerTableState } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type Model } from "@/data/mock";
import { useModelsPage, useManufacturers } from "@/data/db";
import { baht } from "@/lib/utils";
import { postJson, errMsg, exportXlsx } from "@/lib/api";

type ModelForm = { code: string; name: string; brand: string; price: string; status: string };

export default function ModelsPage() {
  const { push } = useToast();
  // 1.1k models — server-side paging/search (ACTIVE + INACTIVE, DELETED hidden)
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  // filter bar (applied on ค้นหา) — same params go to the table query and the Excel export
  type ModelFilter = { brand: string; code: string; name: string; status: "" | "Active" | "Inactive" };
  const NO_FILTER: ModelFilter = { brand: "", code: "", name: "", status: "" };
  const [draft, setDraft] = React.useState<ModelFilter>(NO_FILTER);
  const [filter, setFilter] = React.useState<ModelFilter>(NO_FILTER);
  const { rows: MODELS, total, loading, refetch } = useModelsPage({
    page: table.page,
    pageSize: table.pageSize,
    q: table.q,
    sort: table.sort?.key,
    dir: table.sort?.dir,
    ...filter,
  });
  const { data: MANUFACTURERS } = useManufacturers();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Model | null>(null);
  const [viewOnly, setViewOnly] = React.useState(false);
  const [form, setForm] = React.useState<ModelForm>({ code: "", name: "", brand: "", price: "", status: "Active" });
  const [saving, setSaving] = React.useState(false);
  const set = <K extends keyof ModelForm>(k: K, v: ModelForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const openForm = (m: Model | null, readOnly = false) => {
    setViewOnly(readOnly);
    setEditing(m);
    setForm({
      code: m?.code ?? "",
      name: m?.name ?? "",
      brand: m?.brand ?? MANUFACTURERS[0]?.name ?? "",
      price: m?.price ? String(m.price) : "",
      status: m?.status ?? "Active",
    });
    setOpen(true);
  };

  // ยี่ห้อให้เลือก = ยี่ห้อ Active + ยี่ห้อเดิมของรุ่นที่กำลังแก้ (152 รุ่นสังกัดยี่ห้อ Inactive —
  // ไม่ให้ dropdown เปลี่ยนยี่ห้อโดยไม่ตั้งใจ)
  const brandFilterOptions = React.useMemo(() => MANUFACTURERS.map((m) => ({ value: m.name, label: m.name })), [MANUFACTURERS]);
  const brandOptions = React.useMemo(() => {
    const names = MANUFACTURERS.map((m) => m.name);
    return editing?.brand && !names.includes(editing.brand) ? [editing.brand, ...names] : names;
  }, [MANUFACTURERS, editing]);

  // model_code มาจาก running_no "Model" (MD00001) — สร้างอัตโนมัติตอนเพิ่ม
  const save = async () => {
    if (!form.name.trim() || !form.brand) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องระบุ Model Name และยี่ห้อ" });
      return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ row: Model }>("/api/masters/models", {
        code: editing?.code || undefined,
        name: form.name.trim(),
        brand: form.brand,
        price: form.price,
        status: form.status,
      });
      setOpen(false);
      push({ kind: "success", title: "บันทึกรุ่นสินค้าแล้ว", desc: `${d.row.code} · ${d.row.name}` });
      refetch();
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<Model>[] = [
    {
      key: "code",
      header: "Model Code",
      cell: (r) => <span className="num font-medium">{r.code}</span>,
    },
    { key: "name", header: "Model Name" },
    {
      key: "brand",
      header: "Brand Name",
      cell: (r) => <Badge tone="info">{r.brand}</Badge>,
    },
    {
      key: "price",
      header: "Market Price",
      align: "right",
      width: "140px",
      value: (r) => r.price,
      cell: (r) => <span className="font-medium">{baht(r.price)}</span>,
    },
    {
      key: "updated",
      header: "Last Update",
      hideBelow: "md",
      cell: (r) => <span className="num text-xs text-muted-foreground">{r.updated}</span>,
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
      width: "110px",
      align: "center",
      sortable: false,
      cell: (r) => (
        <RowActions
          onView={() => openForm(r, true)}
          onEdit={() => openForm(r)}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="รุ่นสินค้า"
        description="ทะเบียนรุ่นสินค้าและราคาตลาด ใช้อ้างอิงตอนเปิดงานและเสนอราคา"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => exportXlsx("models", { deleted: "exclude", ...filter })}>
              <Download className="h-3.5 w-3.5" />
              ส่งออก Excel
            </Button>
            <Button size="sm" onClick={() => openForm(null)}>
              <Plus className="h-3.5 w-3.5" />
              เพิ่มรุ่นสินค้า
            </Button>
          </>
        }
      />

      <FilterBar
        onSearch={() => {
          setFilter(draft);
          push({ kind: "info", title: "กรองข้อมูลตามเงื่อนไขแล้ว" });
        }}
        onReset={() => {
          setDraft(NO_FILTER);
          setFilter(NO_FILTER);
        }}
      >
        <Field label="ยี่ห้อผู้ผลิต">
          <SearchSelect
            value={draft.brand}
            onChange={(v) => setDraft((f) => ({ ...f, brand: v }))}
            options={brandFilterOptions}
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            searchPlaceholder="พิมพ์ชื่อยี่ห้อ…"
          />
        </Field>
        <Field label="Model Code">
          <Input placeholder="MD00001" className="num" value={draft.code} onChange={(e) => setDraft((f) => ({ ...f, code: e.target.value }))} />
        </Field>
        <Field label="Model Name">
          <Input placeholder="พิมพ์บางส่วนของชื่อรุ่น" value={draft.name} onChange={(e) => setDraft((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="สถานะ">
          <Select value={draft.status} onChange={(e) => setDraft((f) => ({ ...f, status: e.target.value as ModelFilter["status"] }))}>
            <option value="">ทั้งหมด</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
        </Field>
      </FilterBar>

      <DataTable searchable={false}
        columns={columns}
        rows={MODELS}
        loading={loading}
        rowKey={(r) => r.code}
        server={{ total, onChange: setTable, resetKey: JSON.stringify(filter) }}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={viewOnly ? "รายละเอียดรุ่นสินค้า" : editing ? "แก้ไขรุ่นสินค้า" : "เพิ่มรุ่นสินค้า"}
        size="lg"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              {viewOnly ? "ปิด" : "ยกเลิก"}
            </Button>
            {!viewOnly && (
              <Button size="sm" onClick={save} disabled={saving}>
                บันทึกข้อมูล
              </Button>
            )}
          </>
        }
      >
        <fieldset disabled={viewOnly} className="contents">
        <FieldGrid cols={2}>
          <Field label="Model Code" required>
            <Input value={form.code || "Generate Auto"} readOnly />
          </Field>
          <Field label="Model Name" required>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="ยี่ห้อ" required>
            <SearchSelect value={form.brand} onChange={(v) => set("brand", v)} options={strOptions(brandOptions)} searchPlaceholder="พิมพ์ชื่อยี่ห้อ…" />
          </Field>
          <Field label="Market Price (บาท)" required>
            <Input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              placeholder="0.00"
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              className="text-right num"
            />
          </Field>
          <Field label="สถานะ">
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option>Active</option>
              <option>Inactive</option>
            </Select>
          </Field>
        </FieldGrid>
        </fieldset>
      </Modal>
    </>
  );
}
