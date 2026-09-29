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
import { Input, Textarea, NumberInput } from "@/components/ui/input";
import { SearchSelect, strOptions, withCurrent } from "@/components/shared/search-select";
import { useToast } from "@/components/ui/toast";
import { useApi, useProducts } from "@/data/db";
import { QUOTATION_STATUS_OPTIONS, type Customer } from "@/data/mock";
import { baht } from "@/lib/utils";
import { api, errMsg, qs } from "@/lib/api";
import type { JobDetail } from "@/lib/use-job";
import { useFormErrors } from "@/lib/use-form-errors";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { quotationSchema } from "@/lib/validation/quotation";
import { useMountTime } from "@/lib/use-client";
import { isoDateTime } from "@/lib/dates";

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

export type QuotationFormHandle = {
  payload: () => QuotationPayload;
  customer: () => Customer | null;
  /** check before saving (lib/validation/quotation) — shows the errors; true = OK */
  validate: () => boolean;
  /** API field errors → under the fields; false for any other error */
  fromApi: (err: unknown) => boolean;
};

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
  const fe = useFormErrors();
  const { data: PRODUCTS } = useProducts();
  // an existing quotation fills the form when it mounts — the edit page remounts the form (key) for
  // every quotation it loads or saves, so this is the one place the form takes `initial`
  const [type, setType] = React.useState<"A" | "B">(() => (initial && (initial.type.startsWith("Type B") || initial.type === "VIP") ? "B" : "A"));
  const [profileId, setProfileId] = React.useState(initial?.documentProfileId ?? 0); // ออกเอกสารในนาม — from the job when raised from one
  const [lines, setLines] = React.useState<Line[]>(() =>
    (initial?.lines ?? []).map((l, i) => ({
      id: i + 2,
      code: l.code,
      name: l.detail,
      qty: l.qty,
      price: l.unitPrice,
      itemType: (l.itemType as Line["itemType"]) || "SparePart",
    }))
  );
  const [service, setService] = React.useState(initial?.serviceAmount ?? 0);
  const [discount, setDiscount] = React.useState(() => {
    const pct = initial?.discountFormula.match(/^([\d.]+)%$/);
    return pct ? Number(pct[1]) : 0;
  });
  const [vatRate, setVatRate] = React.useState(initial?.vatRate ?? 0);
  const [remark, setRemark] = React.useState(initial?.remark ?? "");
  const [status, setStatus] = React.useState(initial?.status || QUOTATION_STATUS_OPTIONS[0]);
  const [customer, setCustomer] = React.useState<Customer | null>(initial?.customerDetail ?? null);
  const [contact, setContact] = React.useState(initial?.contactName ?? "");
  const [fax, setFax] = React.useState("");
  const [jobRef, setJobRef] = React.useState(initial?.jobRef ?? "");
  const [job, setJob] = React.useState<JobDetail | null>(initial?.job ?? null);
  const date = initial?.date ?? "";
  const idRef = React.useRef((initial?.lines.length ?? 0) + 1);

  // the form as it opened (a loaded quotation, or empty / filled from ?job=) — anything else is an
  // unsaved edit; the edit page remounts the form for every quotation it loads or saves
  const now = { type, profileId, lines, service, discount, vatRate, remark, status, customer: customer?.code ?? "", contact, fax, jobRef };
  const [saved, setSaved] = React.useState(now);
  const [settled, setSettled] = React.useState(true);
  if (!settled) {
    // ?job= has filled the form in (adjusted while rendering, once) — that is where it starts
    setSettled(true);
    setSaved(now);
  }
  useUnsavedChanges(JSON.stringify(now) !== JSON.stringify(saved));

  // a new quotation's date preview: when the screen opened, Thai time (a loaded one shows its own)
  const openedAt = useMountTime();

  // a job → customer + device info (+ parts flagged "เสนอ" in the repair screen become lines)
  const applyJob = React.useCallback(
    async (j: JobDetail, withParts: boolean) => {
      setJob(j);
      if (mode === "new") setProfileId(j.documentProfileId || 0);
      setJobRef(j.no);
      if (withParts) {
        const quoted = j.parts.filter((p) => p.isQuotation && p.requested > 0);
        if (quoted.length) {
          setLines(
            quoted.map((p) => ({ id: ++idRef.current, code: p.code, name: p.name, qty: p.requested, price: p.unitPrice, itemType: "SparePart" as const }))
          );
        }
        if (j.serviceCost) setService(j.serviceCost);
      }
      if (j.customer) {
        const c = await api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: j.customer.code })}`);
        setCustomer(c.rows[0] ?? null);
      }
    },
    [mode]
  );

  // the job number typed in the form (Enter / leaving the box)
  const loadJob = async (no: string, withParts: boolean) => {
    const v = no.trim().toUpperCase();
    if (!v) return;
    try {
      const d = await api<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(v)}`);
      await applyJob(d.job, withParts);
    } catch (e) {
      push({ kind: "error", title: "ไม่พบหมายเลขงาน", desc: errMsg(e) });
    }
  };

  // /quotation/new?job=J… opens with that job, its customer and its quoted parts filled in — once,
  // from the swr answer's callback (not an effect, not during render)
  const urlJobApplied = React.useRef(false);
  useApi<{ job: JobDetail }>(jobNo && !initial ? `/api/jobs/${encodeURIComponent(jobNo.trim().toUpperCase())}` : null, {
    fresh: true,
    onSuccess: (d) => {
      if (urlJobApplied.current) return;
      urlJobApplied.current = true;
      applyJob(d.job, true)
        .catch((e) => push({ kind: "error", title: "โหลดข้อมูลลูกค้าไม่สำเร็จ", desc: errMsg(e) }))
        .finally(() => setSettled(false));
    },
    onError: (msg) => push({ kind: "error", title: "ไม่พบหมายเลขงาน", desc: msg }),
  });



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


  // a value that changes — typed or filled in from the job — takes its error away
  const { clear } = fe;
  React.useEffect(() => clear("customerCode"), [customer, clear]);
  React.useEffect(() => clear("jobNo"), [jobRef, clear]);

  const payload = (): QuotationPayload => ({
      no: quotationNo || initial?.no || undefined,
      documentProfileId: profileId || undefined,
      type: type === "A" ? "Type A (Normal)" : "Type B (VIP)",
      customerCode: customer?.code ?? "",
      contactName: contact,
      jobNo: jobRef,
      // every row, in screen order (line errors point at the row); the API drops empty rows
      lines: lines.map((l) => ({ code: l.code, detail: l.name, qty: l.qty, unitPrice: l.price, itemType: l.itemType, unit: "หน่วย", discount: 0, discountPercent: 0 })),
      serviceAmount: service,
      discountType: discount > 0 ? "ส่วนลดรวม" : "ไม่มีส่วนลด",
      discountValue: discount,
      discountUnit: "%",
      vatRate,
      remark,
      status,
  });
  React.useImperativeHandle(ref, () => ({
    customer: () => customer,
    payload,
    // an old quotation saved without a job may stay without one ("never worse")
    validate: () => !fe.report(fe.run(quotationSchema(mode === "new" || !!initial?.jobRef?.trim()), payload())),
    fromApi: fe.fromApi,
  }));

  return (
    <>
      <Section
        title="ประเภทใบเสนอราคา"
        icon={FileText}
        actions={<Badge tone="primary">{type === "A" ? "Type A (Normal)" : "Type B (VIP)"}</Badge>}
      >
        <div className="mb-3 sm:max-w-md">
          <ProfileSelect
            value={profileId}
            onChange={(id, how) => {
              setProfileId(id);
              if (how !== "user") setSaved((x) => ({ ...x, profileId: id })); // a default / saved on the spot — not an edit
            }}
            doc={initial?.no || quotationNo ? { kind: "quotation", no: initial?.no || quotationNo || "" } : undefined} />
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
        <Field error={fe.errors.customerCode}>
          <CustomerSelect value={customer} onChange={setCustomer} />
        </Field>
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
            <ReadOnly><span className="num">{date || (openedAt ? isoDateTime(openedAt) : "")} น.</span></ReadOnly>
          </Field>
          <Field label="อ้างถึง หมายเลขงานซ่อม" required={mode === "new" || !!initial?.jobRef?.trim()} error={fe.errors.jobNo}>
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
                        aria-label={`จำนวน แถว ${i + 1}`}
                        aria-invalid={!!fe.errors[`lines.${i}.qty`] || undefined}
                        min={0}
                        placeholder="0"
                        value={l.qty}
                        onChange={(n) => {
                          upd(l.id, { qty: n });
                          fe.clear(`lines.${i}.qty`);
                        }}
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput
                        aria-label={`ราคา/หน่วย แถว ${i + 1}`}
                        aria-invalid={!!fe.errors[`lines.${i}.unitPrice`] || undefined}
                        step="0.01"
                        value={l.price}
                        onChange={(n) => {
                          upd(l.id, { price: n });
                          fe.clear(`lines.${i}.unitPrice`);
                        }}
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
              <SearchSelect value={status} onChange={setStatus} options={withCurrent(strOptions(QUOTATION_STATUS_OPTIONS), status)} />
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
                  aria-label="ค่าบริการ"
                  aria-invalid={!!fe.errors.serviceAmount || undefined}
                  step="0.01"
                  value={service}
                  onChange={(n) => {
                    setService(n);
                    fe.clear("serviceAmount");
                  }}
                  className="h-8 w-32 text-xs"
                />
              </div>
              {deliveryTotal > 0 && <Row label="ค่าขนส่ง" value={baht(deliveryTotal)} />}
              <Row label="รวมเป็นเงิน" value={baht(subtotal)} />
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">ส่วนลด (%)</dt>
                <NumberInput
                  aria-label="ส่วนลด (%)"
                  aria-invalid={!!fe.errors.discountValue || undefined}
                  step="0.01"
                  placeholder="0"
                  value={discount}
                  onChange={(n) => {
                    setDiscount(n);
                    fe.clear("discountValue");
                  }}
                  className="h-8 w-32 text-xs"
                />
              </div>
              <Row label="ส่วนลดเป็นเงิน" value={baht(discountAmt)} />
              <Row label="มูลค่าก่อนภาษี" value={baht(beforeVat)} />
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">ภาษีมูลค่าเพิ่ม (%)</dt>
                <NumberInput
                  aria-label="ภาษีมูลค่าเพิ่ม (%)"
                  aria-invalid={!!fe.errors.vatRate || undefined}
                  step="0.01"
                  placeholder="0"
                  value={vatRate}
                  onChange={(n) => {
                    setVatRate(n);
                    fe.clear("vatRate");
                  }}
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
