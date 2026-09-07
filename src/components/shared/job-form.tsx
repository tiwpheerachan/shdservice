"use client";

import * as React from "react";
import {
  Search,
  UserRound,
  ClipboardList,
  PackageSearch,
  Coins,
  Paperclip,
} from "lucide-react";
import { Section } from "./section";
import { Attachments } from "./attachments";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, Textarea, Radio, Checkbox } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CHANNELS,
  COURIERS,
  RECEIVE_METHODS,
  TECHNICIANS,
  WARRANTY_OPTIONS,
  JOB_STATUS_OPTIONS,
  type Customer,
} from "@/data/mock";
import {
  useCustomers,
  useJobTypes,
  useManufacturers,
  useModels,
  useProductTypes,
  useSymptoms,
} from "@/data/db";
import { baht, cn } from "@/lib/utils";

/* ---------------- lookup bar ---------------- */

export function JobLookupBar({
  label = "ระบุ หมายเลขงาน",
  placeholder = "JOB2604460",
  onFind,
  note,
}: {
  label?: string;
  placeholder?: string;
  onFind?: (v: string) => void;
  note?: string;
}) {
  const [v, setV] = React.useState("");
  return (
    <div className="surface flex flex-wrap items-center gap-3 p-3 no-print">
      <label className="text-sm font-medium">{label} :</label>
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onFind?.(v)}
          placeholder={placeholder}
          className="num pr-8"
        />
        <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
      <Button size="md" onClick={() => onFind?.(v)}>
        <Search className="h-3.5 w-3.5" />
        ค้นหา
      </Button>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

/* ---------------- customer ---------------- */

export function CustomerSection({ readOnly = false }: { readOnly?: boolean }) {
  const { data: CUSTOMERS } = useCustomers();
  const [c, setC] = React.useState<Customer | null>(null);
  const [q, setQ] = React.useState("");

  const find = () => {
    const hit =
      CUSTOMERS.find(
        (x) =>
          x.code.toLowerCase() === q.trim().toLowerCase() ||
          x.name.includes(q.trim()) ||
          x.taxId === q.trim()
      ) ??
      CUSTOMERS[0] ??
      null;
    setC(hit);
  };

  return (
    <Section
      title="ข้อมูลลูกค้า"
      icon={UserRound}
      description="ค้นหาด้วยรหัสลูกค้า หมายเลขบัตร หรือชื่อ-สกุล"
      actions={c && <Badge tone="success" dot>พบข้อมูลลูกค้า</Badge>}
    >
      {!readOnly && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && find()}
            placeholder="รหัส หรือ หมายเลขบัตร หรือ ชื่อสกุล ลูกค้า"
            className="sm:max-w-md"
          />
          <Button variant="outline" size="md" onClick={find}>
            <Search className="h-3.5 w-3.5" />
            ค้นหาลูกค้า
          </Button>
        </div>
      )}

      <FieldGrid>
        <Field label="รหัสลูกค้า" required>
          <Input readOnly value={c?.code ?? ""} placeholder="—" className="num" />
        </Field>
        <Field label="เลขผู้เสียภาษี / เลขบัตรประชาชน">
          <Input readOnly value={c?.taxId ?? ""} placeholder="—" className="num" />
        </Field>
        <Field label="ชื่อลูกค้า" required className="lg:col-span-2">
          <Input readOnly value={c?.name ?? ""} placeholder="—" />
        </Field>
        <Field label="ที่อยู่ลูกค้า" wide>
          <Textarea readOnly rows={2} value={c?.address ?? ""} placeholder="—" />
        </Field>
        <Field label="เบอร์โทรศัพท์" required>
          <Input readOnly value={c?.phone ?? ""} placeholder="—" className="num" />
        </Field>
        <Field label="Line ID">
          <Input readOnly value={c?.line ?? ""} placeholder="—" />
        </Field>
        <Field label="Email" className="lg:col-span-2">
          <Input readOnly value={c?.email ?? ""} placeholder="—" />
        </Field>
      </FieldGrid>
    </Section>
  );
}

/* ---------------- job open info ---------------- */

export function JobOpenSection({
  status = "งานใหม่",
  editable = true,
  jobNo,
}: {
  status?: string;
  editable?: boolean;
  jobNo?: string;
}) {
  const { data: JOB_TYPES } = useJobTypes();
  return (
    <Section title="ข้อมูลการเปิดงาน" icon={ClipboardList}>
      <FieldGrid>
        <Field label="หมายเลขงาน">
          <ReadOnly>
            <span className="num">{jobNo ?? "Generate Auto"}</span>
          </ReadOnly>
        </Field>
        <Field label="วันที่">
          <ReadOnly>
            <span className="num">2026-09-04 12:14:55 น.</span>
          </ReadOnly>
        </Field>
        <Field label="เปิดงานโดย">
          <ReadOnly>May - Pradit</ReadOnly>
        </Field>
        <Field label="สถานะงาน">
          {editable ? (
            <Select defaultValue={status}>
              {JOB_STATUS_OPTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          ) : (
            <ReadOnly>
              <Badge tone="info" dot>
                {status}
              </Badge>
            </ReadOnly>
          )}
        </Field>
        <Field label="ประเภทงานหลัก" required className="lg:col-span-2">
          <Select defaultValue="">
            <option value="">- - Please Select - -</option>
            {JOB_TYPES.map((j) => (
              <option key={j.id}>{j.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="งานย่อย" className="lg:col-span-2">
          <Select defaultValue="">
            <option value="">- - Please Select - -</option>
            <option>เปลี่ยนอะไหล่</option>
            <option>ทำความสะอาด</option>
            <option>อัปเดตเฟิร์มแวร์</option>
            <option>ตรวจเช็คทั่วไป</option>
          </Select>
        </Field>
      </FieldGrid>
    </Section>
  );
}

/* ---------------- product info ---------------- */

export function ProductSection({ title = "ข้อมูลเกี่ยวกับสินค้า" }: { title?: string }) {
  const { data: PRODUCT_TYPES } = useProductTypes();
  const { data: MANUFACTURERS } = useManufacturers();
  const { data: MODELS } = useModels();
  const { data: SYMPTOMS } = useSymptoms();
  const [symptoms, setSymptoms] = React.useState<string[]>([]);

  const toggle = (name: string) =>
    setSymptoms((s) =>
      s.includes(name) ? s.filter((x) => x !== name) : [...s, name]
    );

  return (
    <Section title={title} icon={PackageSearch}>
      <FieldGrid>
        <Field label="Sale Order No." required>
          <Input placeholder="SO2600727" className="num" />
        </Field>
        <Field label="Channel" required>
          <Select defaultValue="">
            <option value="">- - Please Select - -</option>
            {CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Shop Name">
          <Input placeholder="ชื่อร้านค้า" />
        </Field>
        <Field label="Sale Order Date" required>
          <Input type="date" />
        </Field>

        <Field label="รับประกัน (เดือน)" required>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            defaultValue={12}
            onFocus={(e) => e.currentTarget.select()}
            className="num text-right"
          />
        </Field>
        <Field label="Expire Date" required>
          <Input type="date" />
        </Field>
        <Field label="Warranty" required>
          <Select defaultValue="">
            <option value="">- - Please Select - -</option>
            {WARRANTY_OPTIONS.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </Select>
        </Field>
        <Field label="ประเภทสินค้า">
          <Select defaultValue="">
            <option value="">- - Please Select - -</option>
            {PRODUCT_TYPES.map((p) => (
              <option key={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Imei No.">
          <Input className="num" placeholder="35xxxxxxxxxxxxx" />
        </Field>
        <Field label="Serial No." required>
          <Input className="num" placeholder="SN-XXXXXXXX" />
        </Field>
        <Field label="ยี่ห้อ" required>
          <Select defaultValue="">
            <option value="">- - Please Select - -</option>
            {MANUFACTURERS.map((m) => (
              <option key={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="รุ่น" required>
          <Select defaultValue="">
            <option value="">- - Please Select - -</option>
            {MODELS.map((m) => (
              <option key={m.code}>{m.code}</option>
            ))}
          </Select>
        </Field>

        <Field label="รุ่นย่อย (ถ้ามี)">
          <Input />
        </Field>
        <Field label="วันที่รับเข้า">
          <Input type="date" defaultValue="2026-09-04" />
        </Field>
        <Field label="เลขพัสดุจากลูกค้า">
          <Input className="num" />
        </Field>
        <Field label="โดยบริษัทขนส่ง">
          <Select defaultValue="">
            <option value="">- - Please Select - -</option>
            {COURIERS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>

        <Field label="รับสินค้าเข้าโดย" wide>
          <div className="flex flex-wrap gap-4 rounded-md border border-border bg-muted/40 px-3 py-2">
            {RECEIVE_METHODS.map((m, i) => (
              <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
                <Radio name="receive-method" defaultChecked={i === 0} />
                {m}
              </label>
            ))}
          </div>
        </Field>

        <Field label="อุปกรณ์ (ที่นำส่ง)" className="lg:col-span-2">
          <Textarea rows={2} placeholder="เช่น อะแดปเตอร์, รีโมท, กล่อง" />
        </Field>
        <Field label="จุดตำหนิ" className="lg:col-span-2">
          <Textarea rows={2} placeholder="รอยขีดข่วน / รอยบุบ ฯลฯ" />
        </Field>

        <Field
          label="อาการเสียหลัก (มาตรฐาน)"
          required
          wide
          hint={`เลือกแล้ว ${symptoms.length} อาการ`}
        >
          <div className="flex flex-wrap gap-2 rounded-md border border-border bg-muted/40 p-2.5">
            {SYMPTOMS.map((s) => {
              const on = symptoms.includes(s.name);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.name)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary"
                  )}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="อาการเสีย (อื่นๆ)" className="lg:col-span-2">
          <Textarea rows={2} />
        </Field>
        <Field label="หมายเหตุ" className="lg:col-span-2">
          <Textarea rows={2} />
        </Field>
      </FieldGrid>
    </Section>
  );
}

/* ---------------- cost summary ---------------- */

const COST_FIELDS = [
  { key: "service", label: "ค่าบริการการซ่อม" },
  { key: "tool", label: "ค่าเครื่องมือพิเศษ" },
  { key: "ship", label: "ค่าขนส่ง" },
  { key: "box", label: "ค่ากล่องพัสดุ" },
] as const;

/** One label : value : บาท row, stacked so the running total reads top-to-bottom. */
function CostRow({
  label,
  children,
  strong,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      <span
        className={cn(
          "w-40 shrink-0 text-right text-sm sm:w-48",
          strong ? "font-semibold text-foreground" : "text-muted-foreground"
        )}
      >
        {label} :
      </span>
      <div className="w-36 shrink-0 sm:w-44">{children}</div>
      <span
        className={cn(
          "w-8 shrink-0 text-sm",
          strong ? "font-medium" : "text-muted-foreground"
        )}
      >
        บาท
      </span>
    </div>
  );
}

export function CostSummary({ partsTotal = 0 }: { partsTotal?: number }) {
  const [v, setV] = React.useState<Record<string, number>>({
    service: 0,
    tool: 0,
    ship: 0,
    box: 0,
  });

  const net =
    partsTotal + Object.values(v).reduce((a, b) => a + (Number(b) || 0), 0);

  return (
    <Section title="สรุปค่าใช้จ่าย" icon={Coins}>
      <div className="ml-auto max-w-xl space-y-2">
        <CostRow label="รวมค่าอะไหล่">
          <div className="num flex h-9 items-center justify-end rounded-md border border-border bg-muted/60 px-3 text-right text-sm">
            {baht(partsTotal)}
          </div>
        </CostRow>

        {COST_FIELDS.map((f) => (
          <CostRow key={f.key} label={f.label}>
            <input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              value={v[f.key] === 0 ? "" : v[f.key]}
              placeholder="0.00"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) =>
                setV((s) => ({ ...s, [f.key]: Number(e.target.value) || 0 }))
              }
              className="num h-9 w-full rounded-md border border-input bg-card px-3 text-right text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </CostRow>
        ))}

        <div className="border-t border-border pt-2.5">
          <CostRow label="รวมเป็นเงินสุทธิ" strong>
            <div className="num flex h-10 items-center justify-end rounded-md border border-primary/30 bg-primary-soft px-3 text-base font-semibold text-primary">
              {baht(net)}
            </div>
          </CostRow>
        </div>
      </div>
    </Section>
  );
}

/* ---------------- other info ---------------- */

export function OtherInfoSection({ showTech = true }: { showTech?: boolean }) {
  return (
    <Section title="ข้อมูลอื่นๆ" icon={ClipboardList}>
      <FieldGrid>
        <Field label="ค่าประเมินงานซ่อม (บาท)">
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
        <Field label="ค่ามัดจำงานซ่อม (บาท)">
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
        {showTech && (
          <Field label="มอบหมายงานนี้ให้">
            <Select>
              {TECHNICIANS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="วันประเมินซ่อมเสร็จ">
          <Input type="date" />
        </Field>
      </FieldGrid>
    </Section>
  );
}

export function AttachmentSection() {
  return (
    <Section title="เอกสารแนบ" icon={Paperclip}>
      <Attachments />
    </Section>
  );
}

export function FormActions({
  onSave,
  saveLabel = "บันทึกข้อมูล",
  extra,
}: {
  onSave: () => void;
  saveLabel?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-3 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/90 px-3 py-3 backdrop-blur-md sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6 no-print">
      {extra}
      <Button variant="outline" size="md" type="button">
        ยกเลิก
      </Button>
      <Button size="md" onClick={onSave}>
        {saveLabel}
      </Button>
    </div>
  );
}

export function ConfirmCheckbox({ label }: { label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <Checkbox />
      {label}
    </label>
  );
}
