"use client";

import * as React from "react";
import { Plus, Trash2, FileText, UserRound, Wrench, Calculator } from "lucide-react";
import { Section } from "./section";
import { CustomerSelect } from "./customer-select";
import { ProductPicker, type ExtraItem } from "./product-picker";
import { ProfileSelect } from "./profile-select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, Textarea, NumberInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useProducts } from "@/data/db";
import { QUOTATION_STATUS_OPTIONS, type Customer } from "@/data/mock";
import { baht } from "@/lib/utils";
import { api, errMsg, qs } from "@/lib/api";
import type { JobDetail } from "@/lib/use-job";

type Line = { id: number; code: string; name: string; qty: number; price: number; itemType: "SparePart" | "Service" | "Delivery" };

/** Shape returned by GET /api/quotations/:no (subset the form uses). */
export type QuotationLoaded = {
  no: string;
  date: string;
  type: string;
  status: string;
  customerCode?: string;
  contactName: string;
  jobRef: string;
  remark: string;
  serviceAmount?: number;
  discountType: string;
  discountFormula: string;
  vatRate: number;
  lines: { id?: number; itemType: string; code: string; detail: string; qty: number; unitPrice: number }[];
  customerDetail: Customer | null;
  job: JobDetail | null;
  approveDate?: string; // quotation_hd.customer_approve_date
  createdBy?: string;
  documentProfileId?: number; // ออกเอกสารในนาม
};

/** What the page posts to /api/quotations. */
export type QuotationPayload = {
  no?: string;
  documentProfileId?: number;
  type: string;
  customerCode: string;
  contactName: string;
  jobNo: string;
  lines: { code: string; detail: string; qty: number; unitPrice: number; itemType: string; unit: string; discount: number; discountPercent: number }[];
  serviceAmount: number;
  discountType: string;
  discountValue: number;
  discountUnit: "บาท" | "%";
  vatRate: number;
  remark: string;
  status: string;
};

export type QuotationFormHandle = { payload: () => QuotationPayload; customer: () => Customer | null };

/** non-stock line the quotation may carry (legacy SVD0001 = delivery charge, kept out of spare_part_amount) */
const DELIVERY_EXTRA: ExtraItem[] = [{ code: "SVD0001", name: "ค่าขนส่ง" }];

export const QuotationForm = React.forwardRef<
  QuotationFormHandle,
  {
    mode: "new" | "edit";
    quotationNo?: string;
    initial?: QuotationLoaded | null;
    /** job to prefill from (?job= on the new page) */
    jobNo?: string;
  }
>(function QuotationForm({ mode, quotationNo, initial, jobNo }, ref) {
  const { push } = useToast();
  const { data: PRODUCTS } = useProducts();
  const [type, setType] = React.useState<"A" | "B">("A");
  const [profileId, setProfileId] = React.useState(0); // ออกเอกสารในนาม — from the job when raised from one
  const [lines, setLines] = React.useState<Line[]>([]);
  const [service, setService] = React.useState(0);
  const [discount, setDiscount] = React.useState(0);
  const [vatRate, setVatRate] = React.useState(0);
  const [remark, setRemark] = React.useState("");
  const [status, setStatus] = React.useState(QUOTATION_STATUS_OPTIONS[0]);
  const [customer, setCustomer] = React.useState<Customer | null>(null);
  const [contact, setContact] = React.useState("");
  const [fax, setFax] = React.useState("");
  const [jobRef, setJobRef] = React.useState("");
  const [job, setJob] = React.useState<JobDetail | null>(null);
  const [date, setDate] = React.useState("");
  const idRef = React.useRef(1);

  React.useEffect(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    setDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
  }, []);

  // load a job → customer + device info (+ parts flagged "เสนอ" in the repair screen become lines)
  const loadJob = React.useCallback(
    async (no: string, withParts: boolean) => {
      const v = no.trim().toUpperCase();
      if (!v) return;
      try {
        const d = await api<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(v)}`);
        setJob(d.job);
        if (mode === "new") setProfileId(d.job.documentProfileId || 0);
        setJobRef(d.job.no);
        if (d.job.customer) {
          const c = await api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: d.job.customer.code })}`);
          setCustomer(c.rows[0] ?? null);
        }
        if (withParts) {
          const quoted = d.job.parts.filter((p) => p.isQuotation && p.requested > 0);
          if (quoted.length) {
            setLines(
              quoted.map((p) => ({ id: ++idRef.current, code: p.code, name: p.name, qty: p.requested, price: p.unitPrice, itemType: "SparePart" as const }))
            );
          }
          if (d.job.serviceCost) setService(d.job.serviceCost);
        }
      } catch (e) {
        push({ kind: "error", title: "ไม่พบหมายเลขงาน", desc: errMsg(e) });
      }
    },
    [push]
  );

  // prefill from an existing quotation
  React.useEffect(() => {
    if (!initial) return;
    setType(initial.type.startsWith("Type B") || initial.type === "VIP" ? "B" : "A");
    setLines(
      initial.lines.map((l) => ({
        id: ++idRef.current,
        code: l.code,
        name: l.detail,
        qty: l.qty,
        price: l.unitPrice,
        itemType: (l.itemType as Line["itemType"]) || "SparePart",
      }))
    );
    setService(initial.serviceAmount ?? 0);
    const pct = initial.discountFormula.match(/^([\d.]+)%$/);
    setDiscount(pct ? Number(pct[1]) : 0);
    setVatRate(initial.vatRate ?? 0);
    setRemark(initial.remark);
    setStatus(initial.status || QUOTATION_STATUS_OPTIONS[0]);
    setCustomer(initial.customerDetail);
    setContact(initial.contactName);
    setJobRef(initial.jobRef);
    setProfileId(initial.documentProfileId ?? 0);
    setJob(initial.job);
    setDate(initial.date);
  }, [initial]);

  React.useEffect(() => {
    if (jobNo && !initial) void loadJob(jobNo, true);
  }, [jobNo, initial, loadJob]);

  const add = () =>
    setLines((s) => [...s, { id: ++idRef.current + 100, code: "", name: "", qty: 1, price: 0, itemType: "SparePart" }]);

  const upd = (id: number, patch: Partial<Line>) =>
    setLines((s) => s.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const partsTotal = lines.filter((l) => l.itemType !== "Delivery").reduce((s, l) => s + l.qty * l.price, 0);
  const deliveryTotal = lines.filter((l) => l.itemType === "Delivery").reduce((s, l) => s + l.qty * l.price, 0);
  const subtotal = partsTotal + service + deliveryTotal;
  const discountAmt = (subtotal * discount) / 100;
  const beforeVat = subtotal - discountAmt;
  const vat = (beforeVat * vatRate) / 100;
  const net = beforeVat + vat;


  React.useImperativeHandle(ref, () => ({
    customer: () => customer,
    payload: () => ({
      no: quotationNo || initial?.no || undefined,
      documentProfileId: profileId || undefined,
      type: type === "A" ? "Type A (Normal)" : "Type B (VIP)",
      customerCode: customer?.code ?? "",
      contactName: contact,
      jobNo: jobRef,
      lines: lines
        .filter((l) => l.code || l.name)
        .map((l) => ({ code: l.code, detail: l.name, qty: l.qty, unitPrice: l.price, itemType: l.itemType, unit: "หน่วย", discount: 0, discountPercent: 0 })),
      serviceAmount: service,
      discountType: discount > 0 ? "ส่วนลดรวม" : "ไม่มีส่วนลด",
      discountValue: discount,
      discountUnit: "%",
      vatRate,
      remark,
      status,
    }),
  }));

  return (
    <>
      <Section
        title="ประเภทใบเสนอราคา"
        icon={FileText}
        actions={<Badge tone="primary">{type === "A" ? "Type A (Normal)" : "Type B (VIP)"}</Badge>}
      >
        <div className="mb-3 sm:max-w-md">
          <ProfileSelect value={profileId} onChange={setProfileId} doc={initial?.no || quotationNo ? { kind: "quotation", no: initial?.no || quotationNo || "" } : undefined} />
        </div>
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

      <Section title="ข้อมูลลูกค้า" icon={UserRound} description={customer ? "ข้อมูลกลางจากตารางลูกค้า (อ่านอย่างเดียว)" : "เลือก ลูกค้าเดิม เพื่อค้นหา หรือ ลูกค้าใหม่"}>
        <CustomerSelect value={customer} onChange={setCustomer} />
        <FieldGrid className="mt-4">
          <Field label="แฟกซ์">
            <Input className="num" value={fax} onChange={(e) => setFax(e.target.value)} />
          </Field>
          <Field label="ชื่อผู้ติดต่อ" className="lg:col-span-2">
            <Input value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
        </FieldGrid>
      </Section>

      <Section title="ข้อมูลใบเสนอราคา" icon={FileText}>
        <FieldGrid>
          <Field label="หมายเลขใบเสนอราคา">
            <ReadOnly>
              <span className="num">{quotationNo ?? initial?.no ?? (mode === "new" ? "Generate Auto" : "—")}</span>
            </ReadOnly>
          </Field>
          <Field label="วันที่">
            <ReadOnly><span className="num">{date} น.</span></ReadOnly>
          </Field>
          <Field label="อ้างถึง หมายเลขงานซ่อม" required>
            <Input
              className="num"
              placeholder="J2612164"
              value={jobRef}
              onChange={(e) => setJobRef(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadJob(jobRef, lines.length === 0)}
              onBlur={() => jobRef && jobRef.toUpperCase() !== job?.no && loadJob(jobRef, lines.length === 0)}
            />
          </Field>
          <Field label="สถานะงานซ่อม (ปัจจุบัน)">
            <ReadOnly>
              <Badge tone="warning" dot>{job?.status ?? "—"}</Badge>
            </ReadOnly>
          </Field>
        </FieldGrid>
      </Section>

      <Section title="ข้อมูลเครื่องซ่อม" icon={Wrench}>
        <FieldGrid>
          <Field label="เลขคำสั่งซื้อ">
            <Input className="num" value={job?.so ?? ""} readOnly />
          </Field>
          <Field label="หมายเลขอ้างอิง (เลขพัสดุ)">
            <Input className="num" value={job?.receptionTrackingNo ?? ""} readOnly />
          </Field>
          <Field label="เปิดงานวันที่">
            <Input value={job?.createDate ?? ""} readOnly className="num" />
          </Field>
          <Field label="IMEI No.">
            <Input className="num" value={job?.imei ?? ""} readOnly />
          </Field>
          <Field label="ประเภทเครื่องซ่อม">
            <Input value={job?.productType ?? ""} readOnly />
          </Field>
          <Field label="ยี่ห้อ">
            <Input value={job?.brand ?? ""} readOnly />
          </Field>
          <Field label="รุ่น">
            <Input value={job ? [job.modelCode, job.modelName].filter(Boolean).join(" — ") : ""} readOnly />
          </Field>
          <Field label="Warranty">
            <Input value={job?.warranty === "IN" ? "In Warranty" : job?.warranty === "OUT" ? "Out Warranty" : job?.warranty ?? ""} readOnly />
          </Field>
          <Field label="อาการเสีย (มาตรฐาน)" className="lg:col-span-2">
            <Textarea rows={2} value={job?.symptoms.join(", ") ?? ""} readOnly />
          </Field>
          <Field label="อาการเสีย (อื่นๆ)" className="lg:col-span-2">
            <Textarea rows={2} value={job?.symptomOther ?? ""} readOnly />
          </Field>
          <Field label="จุดตำหนิ" className="lg:col-span-2">
            <Textarea rows={2} value={job?.fault ?? ""} readOnly />
          </Field>
          <Field label="อุปกรณ์ (ที่นำส่ง)" className="lg:col-span-2">
            <Textarea rows={2} value={job?.equipment ?? ""} readOnly />
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
                <th className="w-72 px-3 py-2 text-left">รหัสอะไหล่ / ชื่อ</th>
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
                      <ProductPicker
                        products={PRODUCTS}
                        value={l.code}
                        fallbackName={l.name}
                        extras={DELIVERY_EXTRA}
                        size="sm"
                        onPick={(p) =>
                          upd(l.id, {
                            code: p?.code ?? "",
                            name: p ? p.name : l.name,
                            price: p && p.price !== undefined ? p.price : l.price,
                            itemType: p?.code === "SVD0001" ? "Delivery" : "SparePart",
                          })
                        }
                      />
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
              <Textarea rows={4} placeholder="เงื่อนไขการเสนอราคา ระยะเวลายืนราคา ฯลฯ" value={remark} onChange={(e) => setRemark(e.target.value)} />
            </Field>
            <Field label="สถานะใบเสนอราคา" wide>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {QUOTATION_STATUS_OPTIONS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
                {status && !QUOTATION_STATUS_OPTIONS.includes(status) && <option>{status}</option>}
              </Select>
            </Field>
            {initial && (
              <>
                {/* quotation_hd.customer_approve_date — stamped by the server the first time the customer agrees */}
                <Field label="วันที่ลูกค้าตอบรับ">
                  <Input readOnly className="num" value={initial.approveDate || "—"} />
                </Field>
                <Field label="สร้างโดย">
                  <Input readOnly value={initial.createdBy || "—"} />
                </Field>
              </>
            )}
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
              {deliveryTotal > 0 && <Row label="ค่าขนส่ง" value={baht(deliveryTotal)} />}
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
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
