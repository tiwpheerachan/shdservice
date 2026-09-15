"use client";

import * as React from "react";
import { Plus, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type Model } from "@/data/mock";
import { useModels, useManufacturers, useProductTypes } from "@/data/db";
import { baht } from "@/lib/utils";
import { postJson, errMsg } from "@/lib/api";

type ModelForm = { code: string; name: string; brand: string; productType: string; price: string; status: string };

export default function ModelsPage() {
  const { push } = useToast();
  const { data: MODELS, loading, refetch } = useModels("exclude");
  const { data: MANUFACTURERS } = useManufacturers();
  const { data: PRODUCT_TYPES } = useProductTypes();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Model | null>(null);
  const [form, setForm] = React.useState<ModelForm>({ code: "", name: "", brand: "", productType: "", price: "", status: "Active" });
  const [saving, setSaving] = React.useState(false);
  const set = <K extends keyof ModelForm>(k: K, v: ModelForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const openForm = (m: Model | null) => {
    setEditing(m);
    setForm({
      code: m?.code ?? "",
      name: m?.name ?? "",
      brand: m?.brand ?? MANUFACTURERS[0]?.name ?? "",
      productType: PRODUCT_TYPES[0]?.name ?? "",
      price: m?.price ? String(m.price) : "",
      status: m?.status ?? "Active",
    });
    setOpen(true);
  };

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
          onView={() => push({ kind: "info", title: r.code, desc: r.name })}
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
            <Button variant="outline" size="sm">
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

      <DataTable
        columns={columns}
        rows={MODELS}
        loading={loading}
        rowKey={(r) => r.code}
        searchPlaceholder="ค้นหา Model Code / Model Name / Brand…"
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "แก้ไขรุ่นสินค้า" : "เพิ่มรุ่นสินค้า"}
        size="lg"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              บันทึกข้อมูล
            </Button>
          </>
        }
      >
        <FieldGrid cols={2}>
          <Field label="Model Code" required>
            <Input value={form.code || "Generate Auto"} readOnly />
          </Field>
          <Field label="Model Name" required>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="ยี่ห้อ" required>
            <Select value={form.brand} onChange={(e) => set("brand", e.target.value)}>
              {MANUFACTURERS.map((m) => (
                <option key={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="ประเภทเครื่อง">
            <Select value={form.productType} onChange={(e) => set("productType", e.target.value)}>
              {PRODUCT_TYPES.map((p) => (
                <option key={p.id}>{p.name}</option>
              ))}
            </Select>
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
      </Modal>
    </>
  );
}
