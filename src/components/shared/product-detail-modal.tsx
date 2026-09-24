"use client";

import * as React from "react";
import { ImageIcon, Upload } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Select, Textarea, Checkbox, Radio } from "@/components/ui/input";
import { SearchSelect, withCurrent } from "./search-select";
import { useToast } from "@/components/ui/toast";
import {
  useModels,
  useColors,
  useCategories,
  useManufacturers,
} from "@/data/db";
import type { Product } from "@/data/mock";
import { int } from "@/lib/utils";
import { api, postJson, errMsg, uploadFile, fileUrl } from "@/lib/api";

export type ProductMode = "view" | "edit" | "add";

type Card = { no: string; date: string; type: string; before: number; income: number; outcome: number; after: number; ref: string; remark: string };
type Detail = Product & { models: string[] };

type Form = {
  mfgCode: string;
  name: string;
  nameEn: string;
  nameCn: string;
  description: string;
  category: string;
  brand: string;
  capitalPrice: string;
  wholesalePrice: string;
  price: string;
  forModelColor: string;
  status: string;
  models: string[];
};

const EMPTY_FORM: Form = {
  mfgCode: "",
  name: "",
  nameEn: "",
  nameCn: "",
  description: "",
  category: "",
  brand: "",
  capitalPrice: "",
  wholesalePrice: "",
  price: "",
  forModelColor: "",
  status: "Active",
  models: [],
};

const NEW_PRODUCT: Product = {
  sysCode: "",
  mfgCode: "",
  name: "",
  category: "",
  brand: "",
  onhand: 0,
  price: 0,
  status: "Active",
};

export function ProductDetailModal({
  open,
  onClose,
  product,
  mode,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  product: Product | null;
  mode: ProductMode;
  onSave?: (saved: Product) => void;
}) {
  const { push } = useToast();
  const { data: MODELS } = useModels();
  const { data: COLORS } = useColors();
  const { data: CATEGORIES } = useCategories();
  const { data: MANUFACTURERS } = useManufacturers();

  const ro = mode === "view";
  const code = product?.sysCode ?? "";

  // full detail + stock card from the DB (product / product_none_serial / inventory_*)
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [stockCard, setStockCard] = React.useState<Card[]>([]);
  const [form, setForm] = React.useState<Form>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [image, setImage] = React.useState("");
  const [uploading, setUploading] = React.useState(false);

  // รูปอะไหล่ → bucket oneservice/products/{code}/… แล้วเก็บชื่อไฟล์ใน product.pictrue_file_name
  const onPickImage = async (f: File | undefined) => {
    if (!f || !code) return;
    setUploading(true);
    try {
      const d = await uploadFile("product-image", code, f);
      setImage(d.path);
      push({ kind: "success", title: "อัปโหลดรูปแล้ว", desc: f.name });
    } catch (e) {
      push({ kind: "error", title: "อัปโหลดรูปไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setUploading(false);
    }
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  React.useEffect(() => {
    if (!open) return;
    if (mode === "add" || !code) {
      setDetail(null);
      setStockCard([]);
      setImage("");
      setForm({ ...EMPTY_FORM, category: CATEGORIES[0]?.name ?? "", brand: MANUFACTURERS[0]?.name ?? "" });
      return;
    }
    let active = true;
    api<{ product: Detail; card: Card[] }>(`/api/products/${encodeURIComponent(code)}`)
      .then((d) => {
        if (!active) return;
        setDetail(d.product);
        setStockCard(d.card);
        setImage(d.product.image ?? "");
        setForm({
          mfgCode: d.product.mfgCode,
          name: d.product.name,
          nameEn: d.product.nameEn ?? "",
          nameCn: d.product.nameCn ?? "",
          description: d.product.description ?? "",
          category: d.product.category,
          brand: d.product.brand,
          capitalPrice: d.product.capitalPrice ? String(d.product.capitalPrice) : "",
          wholesalePrice: d.product.wholesalePrice ? String(d.product.wholesalePrice) : "",
          price: d.product.price ? String(d.product.price) : "",
          forModelColor: d.product.forModelColor ?? "",
          status: d.product.status,
          models: d.product.models ?? [],
        });
      })
      .catch((e) => push({ kind: "error", title: "โหลดข้อมูลอะไหล่ไม่สำเร็จ", desc: errMsg(e) }));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, code, mode]);

  const save = async () => {
    if (!form.name.trim()) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องระบุชื่ออะไหล่" });
      return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ row: Product }>("/api/products", { ...form, sysCode: code || undefined });
      push({ kind: "success", title: mode === "add" ? "เพิ่มอะไหล่แล้ว" : "บันทึกการแก้ไขอะไหล่แล้ว", desc: d.row.sysCode });
      onSave?.(d.row);
      onClose();
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  if (!product && mode !== "add") return null;
  const p: Product = detail ?? product ?? NEW_PRODUCT;

  // stock on-hand row (single warehouse / condition in the legacy system)
  const onhandRows = [
    {
      sn: "-",
      loc: "คลังสินค้าดี",
      cond: "สินค้าใหม่",
      income: p.received ?? p.onhand,
      outcome: p.issued ?? 0,
      reserve: p.reserved ?? 0,
      avail: p.onhand,
      status: p.status,
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={mode === "view" ? "รายละเอียดอะไหล่" : mode === "add" ? "เพิ่มอะไหล่ใหม่" : "แก้ไขข้อมูลอะไหล่"}
      description={
        mode === "add"
          ? "Mode: Add New · รหัสอะไหล่จะถูกสร้างอัตโนมัติ"
          : `Mode: ${mode === "view" ? "View" : "Edit"} Data · Product ${p.sysCode}`
      }
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {mode === "view" ? "ปิด" : "ยกเลิก"}
          </Button>
          {mode !== "view" && (
            <Button size="sm" onClick={save} disabled={saving}>
              {mode === "add" ? "บันทึกอะไหล่" : "ยืนยันการแก้ไข"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[180px_1fr]">
          {/* image */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Part Image</p>
            <div className="grid aspect-square place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/40 text-muted-foreground">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(image)} alt={p.name} className="h-full w-full object-contain" />
              ) : (
                <div className="text-center">
                  <ImageIcon className="mx-auto h-8 w-8 opacity-40" />
                  <p className="mt-1 text-2xs">NO IMAGE</p>
                </div>
              )}
            </div>
            {!ro && (
              <label
                className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input bg-muted/40 px-2 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
                title={code ? "อัปโหลดรูป (JPG/PNG/WEBP ≤ 10MB)" : "บันทึกอะไหล่ก่อน แล้วค่อยอัปโหลดรูป"}
              >
                <Upload className="h-3.5 w-3.5" /> {uploading ? "กำลังอัปโหลด…" : "เลือกไฟล์"}
                <input
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={!code || uploading}
                  onChange={(e) => onPickImage(e.target.files?.[0])}
                />
              </label>
            )}
          </div>

          {/* fields */}
          <FieldGrid cols={2}>
            <Field label="รหัสอะไหล่ (ระบบ)">
              <Input value={p.sysCode || "Generate Auto"} readOnly className="num" />
            </Field>
            <Field label="รหัสอะไหล่ (ผู้ผลิต)">
              <Input value={form.mfgCode} onChange={(e) => set("mfgCode", e.target.value)} readOnly={ro} className="num" />
            </Field>

            <Field label="ชื่ออะไหล่ (TH)" wide>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} readOnly={ro} />
            </Field>
            <Field label="ชื่ออะไหล่ (EN)" wide>
              <Input value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} readOnly={ro} />
            </Field>
            <Field label="ชื่ออะไหล่ (CN)" wide>
              <Input value={form.nameCn} onChange={(e) => set("nameCn", e.target.value)} readOnly={ro} />
            </Field>
            <Field label="รายละเอียด" wide>
              <Input
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="รายละเอียดเพิ่มเติม"
                readOnly={ro}
              />
            </Field>

            <Field label="หมวดหมู่">
              <SearchSelect
                value={form.category}
                onChange={(v) => set("category", v)}
                options={withCurrent(CATEGORIES.map((c) => ({ value: c.name, label: c.name })), form.category)}
                disabled={ro}
                searchPlaceholder="พิมพ์ชื่อหมวดหมู่…"
              />
            </Field>
            <Field label="คุม S/N (Serial Control)">
              <div className="flex h-9 items-center gap-4">
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Radio name={`sn-${p.sysCode}`} disabled /> True
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Radio name={`sn-${p.sysCode}`} defaultChecked disabled /> False
                </label>
              </div>
            </Field>

            <Field label="ราคาทุน (Capital) — บาท">
              <Input
                type="number"
                step="0.01"
                min={0}
                inputMode="decimal"
                placeholder="0.00"
                value={form.capitalPrice}
                onChange={(e) => set("capitalPrice", e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                readOnly={ro}
                className="num text-right"
              />
            </Field>
            <Field label="ราคาขายส่ง (Wholesale) — บาท">
              <Input
                type="number"
                step="0.01"
                min={0}
                inputMode="decimal"
                placeholder="0.00"
                value={form.wholesalePrice}
                onChange={(e) => set("wholesalePrice", e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                readOnly={ro}
                className="num text-right"
              />
            </Field>
            <Field label="ราคาขายปลีก (Retail) — บาท">
              <Input
                type="number"
                step="0.01"
                min={0}
                inputMode="decimal"
                placeholder="0.00"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                readOnly={ro}
                className="num text-right"
              />
            </Field>
            <Field label="จำนวนคงเหลือ">
              <Input value={p.onhand} readOnly className="num text-right" />
            </Field>

            <Field label="ยี่ห้อ (ผู้ผลิต)" wide>
              <SearchSelect
                value={form.brand}
                onChange={(v) => set("brand", v)}
                options={withCurrent(MANUFACTURERS.map((m) => ({ value: m.name, label: m.name })), form.brand)}
                disabled={ro}
                searchPlaceholder="พิมพ์ชื่อยี่ห้อ…"
              />
            </Field>
          </FieldGrid>
        </div>

        {/* product models */}
        <div>
          <p className="mb-2 text-sm font-medium">ใช้สำหรับ รุ่นสินค้า</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-3 lg:grid-cols-4">
            {MODELS.map((m) => (
              <label
                key={m.code}
                className="flex cursor-pointer items-center gap-2 text-xs"
                title={m.name}
              >
                <Checkbox
                  disabled={ro}
                  checked={form.models.includes(m.code)}
                  onChange={() =>
                    set(
                      "models",
                      form.models.includes(m.code) ? form.models.filter((c) => c !== m.code) : [...form.models, m.code]
                    )
                  }
                />{" "}
                {m.code}
              </label>
            ))}
            {MODELS.length === 0 && (
              <span className="text-xs text-muted-foreground">ไม่มีข้อมูลรุ่นสินค้า</span>
            )}
          </div>
        </div>

        <FieldGrid cols={2}>
          <Field label="ใช้สำหรับ สีสินค้า">
            <SearchSelect
              value={form.forModelColor}
              onChange={(v) => set("forModelColor", v)}
              options={withCurrent(COLORS.map((c) => ({ value: c.name, label: c.name })), form.forModelColor)}
              disabled={ro}
              emptyLabel="- - Please Select - -"
              searchPlaceholder="พิมพ์ชื่อสี…"
            />
          </Field>
          <Field label="สถานะ">
            <div className="flex h-9 items-center gap-4">
              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <Radio
                  name={`status-${p.sysCode}`}
                  checked={form.status === "Active"}
                  onChange={() => set("status", "Active")}
                  disabled={ro}
                />{" "}
                Active
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <Radio
                  name={`status-${p.sysCode}`}
                  checked={form.status !== "Active"}
                  onChange={() => set("status", "Inactive")}
                  disabled={ro}
                />{" "}
                Inactive
              </label>
            </div>
          </Field>
        </FieldGrid>

        {mode !== "add" && (
          <p className="text-2xs text-muted-foreground">
            วันที่สร้าง: {p.createdDate || "—"} · สร้างโดย: {p.createdBy || "—"}
          </p>
        )}

        {/* legacy read-only notes: stock-adjustment log (product_none_serial.remark) + cancel reason */}
        {mode !== "add" && (detail?.stockRemark || detail?.cancelRemark || detail?.cancelDate) && (
          <FieldGrid cols={2}>
            {detail?.stockRemark && (
              <Field label="หมายเหตุสต๊อก (จากระบบเดิม)" wide>
                <Textarea rows={2} readOnly value={detail.stockRemark} />
              </Field>
            )}
            {(detail?.cancelRemark || detail?.cancelDate) && (
              <Field label="เหตุผลที่ยกเลิก" wide>
                <Textarea
                  rows={2}
                  readOnly
                  value={[detail?.cancelRemark, detail?.cancelDate ? `${detail.cancelDate}${detail.cancelBy ? ` · โดย ${detail.cancelBy}` : ""}` : ""].filter(Boolean).join("\n")}
                />
              </Field>
            )}
          </FieldGrid>
        )}

        {/* view-only stock tables */}
        {mode === "view" && (
          <div className="space-y-4 border-t border-border pt-4">
            <div>
              <p className="mb-2 text-sm font-semibold">สินค้าคงเหลือ (Stock Onhand)</p>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                      <th className="w-10 px-3 py-2 text-center">#</th>
                      <th className="px-3 py-2 text-left">S/N</th>
                      <th className="px-3 py-2 text-left">สถานที่จัดเก็บ</th>
                      <th className="px-3 py-2 text-left">สภาพสินค้า</th>
                      <th className="px-3 py-2 text-right">รับเข้า</th>
                      <th className="px-3 py-2 text-right">จ่ายออก</th>
                      <th className="px-3 py-2 text-right">จอง (ขาย)</th>
                      <th className="px-3 py-2 text-right">คงเหลือ</th>
                      <th className="px-3 py-2 text-left">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {onhandRows.map((r, i) => (
                      <tr key={i} className="border-b border-border/70 last:border-0">
                        <td className="num px-3 py-2 text-center text-muted-foreground">{i + 1}</td>
                        <td className="num px-3 py-2">{r.sn}</td>
                        <td className="px-3 py-2">{r.loc}</td>
                        <td className="px-3 py-2">{r.cond}</td>
                        <td className="num px-3 py-2 text-right">{int(r.income)}</td>
                        <td className="num px-3 py-2 text-right">{int(r.outcome)}</td>
                        <td className="num px-3 py-2 text-right">{int(r.reserve)}</td>
                        <td className="num px-3 py-2 text-right font-semibold">{int(r.avail)}</td>
                        <td className="px-3 py-2">
                          <Badge tone={r.status === "Active" ? "success" : "neutral"} dot>
                            {r.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">ประวัติการรับ-จ่าย (Stock Card)</p>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                      <th className="w-10 px-3 py-2 text-center">#</th>
                      <th className="px-3 py-2 text-left">Movement No.</th>
                      <th className="px-3 py-2 text-left">วันที่</th>
                      <th className="px-3 py-2 text-left">ประเภท</th>
                      <th className="px-3 py-2 text-right">Before</th>
                      <th className="px-3 py-2 text-right">รับ (+)</th>
                      <th className="px-3 py-2 text-right">จ่าย (−)</th>
                      <th className="px-3 py-2 text-right">After</th>
                      <th className="px-3 py-2 text-left">Ref No.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockCard.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-xs text-muted-foreground">
                          ยังไม่มีประวัติการเคลื่อนไหว
                        </td>
                      </tr>
                    ) : (
                      stockCard.map((m, i) => (
                        <tr key={i} className="border-b border-border/70 last:border-0">
                          <td className="num px-3 py-2 text-center text-muted-foreground">{i + 1}</td>
                          <td className="num px-3 py-2 font-medium">{m.no}</td>
                          <td className="num px-3 py-2 text-xs">{m.date}</td>
                          <td className="px-3 py-2">{m.type}</td>
                          <td className="num px-3 py-2 text-right">{int(m.before)}</td>
                          <td className="num px-3 py-2 text-right text-success">{int(m.income)}</td>
                          <td className="num px-3 py-2 text-right text-danger">{int(m.outcome)}</td>
                          <td className="num px-3 py-2 text-right font-semibold">{int(m.after)}</td>
                          <td className="num px-3 py-2 text-xs text-muted-foreground">
                            {m.ref || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
