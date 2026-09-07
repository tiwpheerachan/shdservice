"use client";

import * as React from "react";
import { PackageCheck, ClipboardList, Wallet, Printer, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Section } from "@/components/shared/section";
import {
  CustomerSection,
  ProductSection,
  FormActions,
} from "@/components/shared/job-form";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { RETURN_METHODS, COURIERS, PAYMENT_METHODS, CLOSE_STATUS_OPTIONS } from "@/data/mock";
import { baht } from "@/lib/utils";

const SUMMARY = [
  { label: "รวมค่าอะไหล่", v: 1480 },
  { label: "ค่าบริการการซ่อม", v: 500 },
  { label: "ค่าเครื่องมือพิเศษ", v: 0 },
  { label: "ค่าขนส่ง", v: 120 },
  { label: "ค่ากล่องพัสดุ", v: 60 },
];

export default function ClosePage() {
  const { push } = useToast();
  const [tab, setTab] = React.useState("product");
  const [q, setQ] = React.useState("");
  const net = SUMMARY.reduce((s, x) => s + x.v, 0);

  const go = () => {
    const v = q.trim() || "JOB2604460";
    push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: v });
  };

  return (
    <>
      <PageHeader
        title="ปิดงาน - ส่งคืนสินค้า"
        description="ข้อมูลงานบริการ » ปิดงาน-ส่งคืนสินค้า"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="close-job-no"
              className="whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              ระบุ หมายเลขงาน
            </label>
            <div className="relative">
              <Input
                id="close-job-no"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && go()}
                placeholder="JOB2604460"
                className="num h-9 w-44 pr-8"
              />
              <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
            <Button size="md" onClick={go}>
              GO
            </Button>
            <Button variant="outline" size="md" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              พิมพ์ใบส่งคืน
            </Button>
          </div>
        }
      />

      <CustomerSection readOnly />

      <Section title="ข้อมูลการเปิดงาน" icon={ClipboardList}>
        <FieldGrid>
          <Field label="หมายเลขงาน">
            <ReadOnly><span className="num">JOB2604460</span></ReadOnly>
          </Field>
          <Field label="วันที่เปิดงาน">
            <ReadOnly><span className="num">2026-09-04 09:12 น.</span></ReadOnly>
          </Field>
          <Field label="ประเภทงาน">
            <ReadOnly>ซ่อมนอกประกัน (Out-Warranty)</ReadOnly>
          </Field>
          <Field label="สถานะงาน (ปัจจุบัน)">
            <ReadOnly>
              <Badge tone="success" dot>ซ่อมเสร็จ</Badge>
            </ReadOnly>
          </Field>
        </FieldGrid>
      </Section>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "product", label: "ข้อมูลสินค้า" },
          { key: "work", label: "รายละเอียดการดำเนินงาน" },
          { key: "payment", label: "รายละเอียดการรับชำระเงิน" },
        ]}
      />

      {tab === "product" && <ProductSection title="ข้อมูลสินค้า" />}

      {tab === "work" && (
        <Section title="รายละเอียดการดำเนินงาน" icon={ClipboardList}>
          <FieldGrid>
            <Field label="อาการเสีย (มาตรฐาน)" className="lg:col-span-2">
              <Textarea rows={2} readOnly value="เปิดเครื่องไม่ติด" />
            </Field>
            <Field label="วิธีการซ่อมที่ดำเนินการ" className="lg:col-span-2">
              <Textarea rows={2} readOnly value="เปลี่ยนแผงวงจรหลักและทดสอบการทำงาน 24 ชม." />
            </Field>
            <Field label="ช่างผู้รับผิดชอบ">
              <ReadOnly>Nattapong K.</ReadOnly>
            </Field>
            <Field label="วันที่ซ่อมเสร็จ">
              <ReadOnly><span className="num">2026-09-03</span></ReadOnly>
            </Field>
          </FieldGrid>
        </Section>
      )}

      {tab === "payment" && (
        <Section title="รายละเอียดการรับชำระเงิน" icon={Wallet}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <ul className="space-y-2 text-sm">
                {SUMMARY.map((s) => (
                  <li key={s.label} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="num">{baht(s.v)}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
                  <span>รวมเป็นเงินสุทธิ</span>
                  <span className="num text-primary">{baht(net)} ฿</span>
                </li>
              </ul>
            </div>
            <FieldGrid cols={2}>
              <Field label="วิธีการชำระเงิน" required>
                <Select>
                  {PAYMENT_METHODS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              <Field label="จำนวนเงินที่ชำระ (บาท)">
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={net || undefined}
                  onFocus={(e) => e.currentTarget.select()}
                  className="num text-right"
                />
              </Field>
              <Field label="วันที่ชำระเงิน">
                <Input type="date" defaultValue="2026-09-04" />
              </Field>
              <Field label="เลขที่ใบเสร็จ">
                <Input className="num" />
              </Field>
              <Field label="หมายเหตุ" wide>
                <Textarea rows={2} />
              </Field>
            </FieldGrid>
          </div>
        </Section>
      )}

      <Section title="ข้อมูลการปิดงาน - ส่งคืนสินค้า" icon={PackageCheck}>
        <FieldGrid>
          <Field label="วิธีการส่งคืนสินค้า" required>
            <Select defaultValue="">
              <option value="">- - Please Select - -</option>
              {RETURN_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="วันที่ส่งคืน" required>
            <Input type="date" defaultValue="2026-09-04" />
          </Field>
          <Field label="บริษัทขนส่ง">
            <Select defaultValue="">
              <option value="">- - Please Select - -</option>
              {COURIERS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="หมายเลขพัสดุ">
            <Input className="num" />
          </Field>
          <Field label="รายละเอียดการส่งคืน" wide>
            <Textarea rows={2} />
          </Field>
          <Field label="โปรดระบุ สถานะงาน" required wide>
            <Select defaultValue="">
              <option value="">- - Please Select - -</option>
              {CLOSE_STATUS_OPTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </FieldGrid>
      </Section>

      <FormActions
        saveLabel="ยืนยันปิดงาน"
        onSave={() =>
          push({ kind: "success", title: "ปิดงานและบันทึกการส่งคืนเรียบร้อย", desc: "JOB2604460" })
        }
      />
    </>
  );
}
