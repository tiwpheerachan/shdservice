"use client";

import * as React from "react";
import { Plus, Trash2, UserRound, FileText, ShoppingCart, Wallet } from "lucide-react";
import { Section } from "./section";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, Textarea, Radio, NumberInput } from "@/components/ui/input";
import { PAYMENT_METHODS } from "@/data/mock";
import { useProducts, useUsers } from "@/data/db";
import { baht } from "@/lib/utils";

type Line = { id: number; code: string; name: string; qty: number; price: number };

export function SaleOrderForm({ soNo }: { soNo?: string }) {
  const { data: PRODUCTS } = useProducts();
  const { data: USERS } = useUsers();
  const [lines, setLines] = React.useState<Line[]>([]);
  const [code, setCode] = React.useState("");
  const [qty, setQty] = React.useState(1);
  const idRef = React.useRef(0);

  const add = () => {
    const p = PRODUCTS.find((x) => x.sysCode === code);
    if (!p) return;
    setLines((s) => [
      ...s,
      { id: ++idRef.current, code: p.sysCode, name: p.name, qty, price: p.price },
    ]);
    setCode("");
    setQty(1);
  };

  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

  return (
    <>
      <Section title="Customer Info" icon={UserRound}>
        <FieldGrid>
          <Field label="รหัสลูกค้า" required>
            <Input className="num" placeholder="C0010234" />
          </Field>
          <Field label="เลขผู้เสียภาษี">
            <Input className="num" />
          </Field>
          <Field label="ชื่อลูกค้า" required className="lg:col-span-2">
            <Input />
          </Field>
          <Field label="ที่อยู่ลูกค้า" wide>
            <Textarea rows={2} />
          </Field>
          <Field label="เบอร์โทรศัพท์ลูกค้า" required>
            <Input className="num" />
          </Field>
          <Field label="Line ID">
            <Input />
          </Field>
          <Field label="Email" className="lg:col-span-2">
            <Input type="email" />
          </Field>
        </FieldGrid>
      </Section>

      <Section title="Sale Order Info" icon={FileText}>
        <FieldGrid>
          <Field label="เลขใบสั่งขาย">
            <ReadOnly>
              <span className="num">{soNo ?? "Generate Auto"}</span>
            </ReadOnly>
          </Field>
          <Field label="วันที่สร้าง">
            <ReadOnly><span className="num">2026-09-04 12:17</span></ReadOnly>
          </Field>
          <Field label="สร้างโดย">
            <ReadOnly>May - Pradit</ReadOnly>
          </Field>
          <Field label="พนักงานขาย" required>
            <Select defaultValue="">
              <option value="">- - ยังไม่ระบุ - -</option>
              {USERS.map((u) => (
                <option key={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>
        </FieldGrid>
      </Section>

      <Section
        title="รายการสินค้า"
        icon={ShoppingCart}
        bodyClassName="p-0"
      >
        <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-end">
          <Field label="รหัสสินค้า หรือ ชื่อสินค้า" className="flex-1">
            <Select value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">- - เลือกสินค้า - -</option>
              {PRODUCTS.map((p) => (
                <option key={p.sysCode} value={p.sysCode}>
                  {p.sysCode} — {p.name.slice(0, 60)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="จำนวน" className="sm:w-28">
            <NumberInput
              min={1}
              placeholder="1"
              value={qty}
              onChange={(n) => setQty(n)}
            />
          </Field>
          <Field label="หน่วยนับ" className="sm:w-28">
            <Input readOnly value="Pcs." />
          </Field>
          <Button size="md" onClick={add} disabled={!code}>
            <Plus className="h-3.5 w-3.5" />
            เพิ่มรายการ
          </Button>
        </div>

        <div className="table-scroll rounded-none">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-3 py-2 text-left">#</th>
                <th className="w-28 px-3 py-2 text-left">Item Code</th>
                <th className="px-3 py-2 text-left">รายละเอียดสินค้า</th>
                <th className="w-20 px-3 py-2 text-right">จำนวน</th>
                <th className="w-28 px-3 py-2 text-right">ราคาขาย/หน่วย</th>
                <th className="w-28 px-3 py-2 text-right">เป็นเงิน</th>
                <th className="w-16 px-3 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    ยังไม่มีรายการสินค้า
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => (
                  <tr key={l.id} className="border-b border-border/70 last:border-0">
                    <td className="num px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="num px-3 py-2 font-medium">{l.code}</td>
                    <td className="px-3 py-2">
                      <span className="line-clamp-2 max-w-[320px]">{l.name}</span>
                    </td>
                    <td className="num px-3 py-2 text-right">{l.qty}</td>
                    <td className="num px-3 py-2 text-right">{baht(l.price)}</td>
                    <td className="num px-3 py-2 text-right font-medium">
                      {baht(l.qty * l.price)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => setLines((s) => s.filter((x) => x.id !== l.id))}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                        aria-label="ลบ"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="bg-muted/50 font-semibold">
                <td colSpan={5} className="px-3 py-2 text-right">
                  รวมเป็นเงินทั้งสิ้น
                </td>
                <td className="num px-3 py-2 text-right text-primary">{baht(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section title="การชำระเงินและเอกสาร" icon={Wallet}>
        <FieldGrid>
          <Field label="วิธีการชำระเงิน" required className="lg:col-span-2">
            <div className="flex flex-wrap gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
              {PAYMENT_METHODS.map((p, i) => (
                <label key={p} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Radio name="payment" defaultChecked={i === 0} />
                  {p}
                </label>
              ))}
            </div>
          </Field>
          <Field label="จำนวนเงินที่ชำระ (บาท)">
            <Input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              placeholder="0.00"
              onFocus={(e) => e.currentTarget.select()}
              className="num text-right"
            />
          </Field>
          <Field label="สลิปหลักฐานการโอน">
            <Input type="file" className="h-9 py-1.5 text-xs" />
          </Field>
          <Field label="หมายเหตุ" wide>
            <Textarea rows={2} />
          </Field>
          <Field label="Action" required wide>
            <div className="flex flex-wrap gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
              {["กำลังดำเนินการจัดทำ (In Progress)", "Send To Approve"].map((a, i) => (
                <label key={a} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Radio name="so-action" defaultChecked={i === 0} />
                  {a}
                </label>
              ))}
            </div>
          </Field>
        </FieldGrid>
      </Section>
    </>
  );
}
