"use client";

import * as React from "react";
import { ImageIcon, Upload } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Select, Textarea, Checkbox, Radio } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  useModels,
  useColors,
  useCategories,
  useManufacturers,
} from "@/data/db";
import type { Product } from "@/data/mock";
import { baht, int } from "@/lib/utils";

export type ProductMode = "view" | "edit";

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
  onSave?: () => void;
}) {
  const { push } = useToast();
  const { data: MODELS } = useModels();
  const { data: COLORS } = useColors();
  const { data: CATEGORIES } = useCategories();
  const { data: MANUFACTURERS } = useManufacturers();

  const ro = mode === "view";

  if (!product) return null;

  // demo stock rows derived from the product's on-hand quantity
  const onhandRows = [
    {
      sn: "-",
      loc: "คลังสินค้าดี",
      cond: "สินค้าใหม่",
      income: product.onhand,
      outcome: 0,
      reserve: 0,
      avail: product.onhand,
      status: product.status,
    },
  ];
  const stockCard =
    product.onhand > 0
      ? [
          {
            no: "WHI2601349",
            date: "2026-09-04 14:54",
            type: "รับเข้า",
            before: 0,
            income: product.onhand,
            outcome: 0,
            after: product.onhand,
            ref: "",
            remark: "",
          },
        ]
      : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={mode === "view" ? "รายละเอียดอะไหล่" : "แก้ไขข้อมูลอะไหล่"}
      description={`Mode: ${mode === "view" ? "View" : "Edit"} Data · Product ${product.sysCode}`}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {mode === "view" ? "ปิด" : "ยกเลิก"}
          </Button>
          {mode === "edit" && (
            <Button
              size="sm"
              onClick={() => {
                onSave?.();
                push({ kind: "success", title: "บันทึกการแก้ไขอะไหล่แล้ว", desc: product.sysCode });
                onClose();
              }}
            >
              ยืนยันการแก้ไข
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
            <div className="grid aspect-square place-items-center rounded-lg border border-dashed border-border bg-muted/40 text-muted-foreground">
              <div className="text-center">
                <ImageIcon className="mx-auto h-8 w-8 opacity-40" />
                <p className="mt-1 text-2xs">NO IMAGE</p>
              </div>
            </div>
            {!ro && (
              <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input bg-muted/40 px-2 text-xs text-muted-foreground hover:border-primary hover:text-foreground">
                <Upload className="h-3.5 w-3.5" /> เลือกไฟล์
                <input type="file" className="hidden" />
              </label>
            )}
          </div>

          {/* fields */}
          <FieldGrid cols={2}>
            <Field label="รหัสอะไหล่ (ระบบ)">
              <Input defaultValue={product.sysCode} readOnly className="num" />
            </Field>
            <Field label="รหัสอะไหล่ (ผู้ผลิต)">
              <Input defaultValue={product.mfgCode} readOnly={ro} className="num" />
            </Field>

            <Field label="ชื่ออะไหล่ (TH)" wide>
              <Input defaultValue={product.name} readOnly={ro} />
            </Field>
            <Field label="ชื่ออะไหล่ (EN)" wide>
              <Input defaultValue={product.name} readOnly={ro} />
            </Field>
            <Field label="ชื่ออะไหล่ (CN)" wide>
              <Input defaultValue={product.name} readOnly={ro} />
            </Field>
            <Field label="รายละเอียด" wide>
              <Input defaultValue="" placeholder="รายละเอียดเพิ่มเติม" readOnly={ro} />
            </Field>

            <Field label="หมวดหมู่">
              <Select defaultValue={product.category} disabled={ro}>
                {CATEGORIES.map((c) => (
                  <option key={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="คุม S/N (Serial Control)">
              <div className="flex h-9 items-center gap-4">
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Radio name={`sn-${product.sysCode}`} disabled={ro} /> True
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Radio name={`sn-${product.sysCode}`} defaultChecked disabled={ro} /> False
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
                defaultValue={product.price ? product.price : undefined}
                onFocus={(e) => e.currentTarget.select()}
                readOnly={ro}
                className="num text-right"
              />
            </Field>
            <Field label="จำนวนคงเหลือ">
              <Input defaultValue={product.onhand} readOnly className="num text-right" />
            </Field>

            <Field label="ยี่ห้อ (ผู้ผลิต)" wide>
              <Select defaultValue={product.brand} disabled={ro}>
                {MANUFACTURERS.map((m) => (
                  <option key={m.id}>{m.name}</option>
                ))}
              </Select>
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
              >
                <Checkbox disabled={ro} /> {m.code}
              </label>
            ))}
            {MODELS.length === 0 && (
              <span className="text-xs text-muted-foreground">ไม่มีข้อมูลรุ่นสินค้า</span>
            )}
          </div>
        </div>

        <FieldGrid cols={2}>
          <Field label="ใช้สำหรับ สีสินค้า">
            <Select defaultValue="" disabled={ro}>
              <option value="">- - Please Select - -</option>
              {COLORS.map((c) => (
                <option key={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="สถานะ">
            <div className="flex h-9 items-center gap-4">
              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <Radio
                  name={`status-${product.sysCode}`}
                  defaultChecked={product.status === "Active"}
                  disabled={ro}
                />{" "}
                Active
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <Radio
                  name={`status-${product.sysCode}`}
                  defaultChecked={product.status !== "Active"}
                  disabled={ro}
                />{" "}
                Inactive
              </label>
            </div>
          </Field>
        </FieldGrid>

        <p className="text-2xs text-muted-foreground">
          วันที่สร้าง: 2026-09-04 14:50 น. · สร้างโดย: Demo888
        </p>

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
