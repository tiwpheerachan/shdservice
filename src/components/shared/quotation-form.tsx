"use client";

import * as React from "react";
import { Plus, Trash2, FileText, UserRound, Wrench, Calculator } from "lucide-react";
import { Section } from "./section";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, Textarea, NumberInput } from "@/components/ui/input";
import { useProducts } from "@/data/db";
import { QUOTATION_STATUS_OPTIONS } from "@/data/mock";
import { baht } from "@/lib/utils";

type Line = { id: number; code: string; name: string; qty: number; price: number };

export function QuotationForm({
  mode,
  quotationNo,
}: {
  mode: "new" | "edit";
  quotationNo?: string;
}) {
  const { data: PRODUCTS } = useProducts();
  const [type, setType] = React.useState<"A" | "B">("A");
  const [lines, setLines] = React.useState<Line[]>([
    {
      id: 1,
      code: "P02535",
      name: "อะไหล่-Levoit Core300S Main Board (แผงวงจรหลัก)",
      qty: 1,
      price: 890,
    },
  ]);
  const [service, setService] = React.useState(500);
  const [discount, setDiscount] = React.useState(0);
  const [vatRate, setVatRate] = React.useState(7);
  const idRef = React.useRef(1);

  const add = () =>
    setLines((s) => [
      ...s,
      { id: ++idRef.current + 100, code: "", name: "", qty: 1, price: 0 },
    ]);

  const upd = (id: number, patch: Partial<Line>) =>
    setLines((s) => s.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const partsTotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const subtotal = partsTotal + service;
  const discountAmt = (subtotal * discount) / 100;
  const beforeVat = subtotal - discountAmt;
  const vat = (beforeVat * vatRate) / 100;
  const net = beforeVat + vat;

  return (
    <>
      <Section
        title="ประเภทใบเสนอราคา"
        icon={FileText}
        actions={<Badge tone="primary">{type === "A" ? "Type A (Normal)" : "Type B (VIP)"}</Badge>}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          {(["A", "B"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={
                "flex-1 rounded-lg border px-4 py-3 text-left transition-colors " +
                (type === t
                  ? "border-primary bg-primary-soft"
                  : "border-border bg-card hover:border-input")
              }
            >
              <p className={"text-sm font-medium " + (type === t ? "text-primary" : "")}>
                {t === "A" ? "Type A (Normal)" : "Type B (VIP)"}
              </p>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                {t === "A"
                  ? "ราคามาตรฐานสำหรับลูกค้าทั่วไป"
                  : "ราคาพิเศษสำหรับลูกค้า VIP / คู่ค้า"}
              </p>
            </button>
          ))}
        </div>
      </Section>

      <Section title="ข้อมูลลูกค้า" icon={UserRound}>
        <FieldGrid>
          <Field label="รหัสลูกค้า" required>
            <Input className="num" defaultValue="C0010234" />
          </Field>
          <Field label="เลขบัตรประชาชน / ผู้เสียภาษี">
            <Input className="num" defaultValue="1100200334455" />
          </Field>
          <Field label="ชื่อลูกค้า" required className="lg:col-span-2">
            <Input defaultValue="คุณ สมหญิง ใจดี" />
          </Field>
          <Field label="ที่อยู่ลูกค้า" wide>
            <Textarea rows={2} defaultValue="88/12 ถ.รัชดาภิเษก แขวงดินแดง เขตดินแดง กรุงเทพฯ 10400" />
          </Field>
          <Field label="เบอร์โทรศัพท์">
            <Input className="num" defaultValue="081-555-0123" />
          </Field>
          <Field label="แฟกซ์">
            <Input className="num" />
          </Field>
          <Field label="ชื่อผู้ติดต่อ" className="lg:col-span-2">
            <Input />
          </Field>
        </FieldGrid>
      </Section>

      <Section title="ข้อมูลใบเสนอราคา" icon={FileText}>
        <FieldGrid>
          <Field label="หมายเลขใบเสนอราคา">
            <ReadOnly>
              <span className="num">{quotationNo ?? (mode === "new" ? "Generate Auto" : "—")}</span>
            </ReadOnly>
          </Field>
          <Field label="วันที่">
            <ReadOnly><span className="num">2026-09-04 12:20 น.</span></ReadOnly>
          </Field>
          <Field label="อ้างถึง หมายเลขงานซ่อม" required>
            <Input className="num" placeholder="JOB2604460" />
          </Field>
          <Field label="สถานะงานซ่อม (ปัจจุบัน)">
            <ReadOnly>
              <Badge tone="warning" dot>อยู่ระหว่างดำเนินการ</Badge>
            </ReadOnly>
          </Field>
        </FieldGrid>
      </Section>

      <Section title="ข้อมูลเครื่องซ่อม" icon={Wrench}>
        <FieldGrid>
          <Field label="เลขคำสั่งซื้อ">
            <Input className="num" defaultValue="SO2600727" />
          </Field>
          <Field label="หมายเลขอ้างอิง (เลขพัสดุ)">
            <Input className="num" />
          </Field>
          <Field label="เปิดงานวันที่">
            <Input type="date" defaultValue="2026-09-04" />
          </Field>
          <Field label="IMEI No.">
            <Input className="num" />
          </Field>
          <Field label="ประเภทเครื่องซ่อม">
            <Input defaultValue="เครื่องฟอกอากาศ" />
          </Field>
          <Field label="ยี่ห้อ">
            <Input defaultValue="Levoit." />
          </Field>
          <Field label="รุ่น">
            <Input defaultValue="Core300S" />
          </Field>
          <Field label="Warranty">
            <Input defaultValue="In Warranty" />
          </Field>
          <Field label="อาการเสีย (มาตรฐาน)" className="lg:col-span-2">
            <Textarea rows={2} defaultValue="เปิดเครื่องไม่ติด" />
          </Field>
          <Field label="อาการเสีย (อื่นๆ)" className="lg:col-span-2">
            <Textarea rows={2} />
          </Field>
          <Field label="จุดตำหนิ" className="lg:col-span-2">
            <Textarea rows={2} />
          </Field>
          <Field label="อุปกรณ์ (ที่นำส่ง)" className="lg:col-span-2">
            <Textarea rows={2} />
          </Field>
        </FieldGrid>
      </Section>

      <Section
        title="รายการอะไหล่และบริการ"
        icon={Calculator}
        actions={
          <Button size="sm" variant="outline" onClick={add}>
            <Plus className="h-3.5 w-3.5" />
            เพิ่มรายการ
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className="table-scroll rounded-none">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-3 py-2 text-left">#</th>
                <th className="w-40 px-3 py-2 text-left">รหัสอะไหล่</th>
                <th className="px-3 py-2 text-left">รายละเอียด</th>
                <th className="w-20 px-3 py-2 text-right">จำนวน</th>
                <th className="w-28 px-3 py-2 text-right">ราคา/หน่วย</th>
                <th className="w-28 px-3 py-2 text-right">เป็นเงิน</th>
                <th className="w-16 px-3 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    ยังไม่มีรายการ
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => (
                  <tr key={l.id} className="border-b border-border/70 last:border-0">
                    <td className="num px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2">
                      <Select
                        value={l.code}
                        onChange={(e) => {
                          const p = PRODUCTS.find((x) => x.sysCode === e.target.value);
                          upd(l.id, {
                            code: e.target.value,
                            name: p?.name ?? "",
                            price: p?.price ?? 0,
                          });
                        }}
                        className="h-8 text-xs"
                      >
                        <option value="">- เลือก -</option>
                        {PRODUCTS.map((p) => (
                          <option key={p.sysCode} value={p.sysCode}>
                            {p.sysCode}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={l.name}
                        onChange={(e) => upd(l.id, { name: e.target.value })}
                        className="h-8 text-xs"
                        placeholder="รายละเอียดรายการ"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput
                        min={0}
                        placeholder="0"
                        value={l.qty}
                        onChange={(n) => upd(l.id, { qty: n })}
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput
                        step="0.01"
                        value={l.price}
                        onChange={(n) => upd(l.id, { price: n })}
                        className="h-8 text-xs"
                      />
                    </td>
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
          </table>
        </div>

        <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
          <FieldGrid cols={2}>
            <Field label="หมายเหตุ" wide>
              <Textarea rows={4} placeholder="เงื่อนไขการเสนอราคา ระยะเวลายืนราคา ฯลฯ" />
            </Field>
            <Field label="สถานะใบเสนอราคา" wide>
              <Select defaultValue="รอเสนอราคา">
                {QUOTATION_STATUS_OPTIONS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
          </FieldGrid>

          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <dl className="space-y-2 text-sm">
              <Row label="รวมค่าอะไหล่" value={baht(partsTotal)} />
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">ค่าบริการ</dt>
                <NumberInput
                  step="0.01"
                  value={service}
                  onChange={(n) => setService(n)}
                  className="h-8 w-32 text-xs"
                />
              </div>
              <Row label="รวมเป็นเงิน" value={baht(subtotal)} />
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">ส่วนลด (%)</dt>
                <NumberInput
                  step="0.01"
                  placeholder="0"
                  value={discount}
                  onChange={(n) => setDiscount(n)}
                  className="h-8 w-32 text-xs"
                />
              </div>
              <Row label="ส่วนลดเป็นเงิน" value={baht(discountAmt)} />
              <Row label="มูลค่าก่อนภาษี" value={baht(beforeVat)} />
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">ภาษีมูลค่าเพิ่ม (%)</dt>
                <NumberInput
                  step="0.01"
                  placeholder="0"
                  value={vatRate}
                  onChange={(n) => setVatRate(n)}
                  className="h-8 w-32 text-xs"
                />
              </div>
              <Row label="ภาษีมูลค่าเพิ่ม" value={baht(vat)} />
              <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
                <dt>รวมเป็นเงินสุทธิ</dt>
                <dd className="num text-primary">{baht(net)} ฿</dd>
              </div>
            </dl>
          </div>
        </div>
      </Section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
