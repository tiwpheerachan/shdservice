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
import { SymptomPicker } from "./symptom-picker";
import { CustomerSelect } from "./customer-select";
import { Attachments, type AttachmentsHandle } from "./attachments";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, Textarea, Radio, Checkbox } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CHANNELS,
  RECEIVE_METHODS,
  WARRANTY_OPTIONS,
  JOB_STATUS_OPTIONS,
  type Customer,
} from "@/data/mock";
import {
  useJobTypes,
  useJobTypeDetails,
  useShippers,
  useSymptomStats,
  useModelSymptoms,
  useManufacturers,
  useModels,
  useProductTypes,
  useSymptoms,
  useStaff,
} from "@/data/db";
import { PeoplePicker, type Person } from "./people-picker";
import { baht, cn } from "@/lib/utils";
import { patchJson } from "@/lib/api";
import { useAccess } from "@/lib/use-access";
import type { JobDetail } from "@/lib/use-job";

/* ------------------------------------------------------------------ *
 * Shared form state. Every section reads/writes this through context, and
 * the page posts `toJobInput(state)` to the API. `fromJob(detail)` prefills
 * from a loaded job (แก้ไข / บันทึกซ่อม / ปิดงาน …).
 * ------------------------------------------------------------------ */
export type JobFormState = {
  customer: Customer | null;
  jobNo: string;
  createDate: string;
  createByName: string;
  status: string;
  jobType: string;
  jobTypeDetail: string;
  isBounce: boolean; // งานเด้ง (job.is_job_bounce)
  so: string;
  channel: string;
  shopName: string;
  saleOrderDate: string;
  warrantyMonth: string;
  expireDate: string;
  warranty: string;
  productType: string;
  imei: string;
  serial: string;
  brand: string;
  modelCode: string;
  modelDetail: string;
  receptionDate: string;
  receptionTrackingNo: string;
  receptionShipper: string;
  receptionType: string;
  equipment: string;
  fault: string;
  symptoms: string[];
  symptomOther: string;
  remark: string;
  serviceCost: number;
  toolCost: number;
  deliveryCost: number;
  boxCost: number;
  partsCost: number;
  estimateCost: string;
  depositCost: string;
  engineerId: number;
  engineerName: string;
  engineerEmail: string;
  dueDate: string;
};

export const EMPTY_JOB_FORM: JobFormState = {
  customer: null,
  jobNo: "",
  createDate: "",
  createByName: "",
  status: "งานใหม่",
  jobType: "",
  jobTypeDetail: "",
  isBounce: false,
  so: "",
  channel: "",
  shopName: "",
  saleOrderDate: "",
  warrantyMonth: "12",
  expireDate: "",
  warranty: "",
  productType: "",
  imei: "",
  serial: "",
  brand: "",
  modelCode: "",
  modelDetail: "",
  receptionDate: "",
  receptionTrackingNo: "",
  receptionShipper: "",
  receptionType: RECEIVE_METHODS[0],
  equipment: "",
  fault: "",
  symptoms: [],
  symptomOther: "",
  remark: "",
  serviceCost: 0,
  toolCost: 0,
  deliveryCost: 0,
  boxCost: 0,
  partsCost: 0,
  estimateCost: "",
  depositCost: "",
  engineerId: 0,
  engineerName: "",
  engineerEmail: "",
  dueDate: "",
};

/** Prefill the form from a job loaded through /api/jobs/:no */
export function fromJob(j: JobDetail): JobFormState {
  return {
    ...EMPTY_JOB_FORM,
    customer: j.customer
      ? {
          code: j.customer.code,
          name: j.customer.name,
          address: j.customer.address,
          phone: j.customer.phone,
          email: j.customer.email,
          line: j.customer.line,
          taxId: j.customer.taxId,
          status: "Active",
          id: j.customer.id,
        }
      : null,
    jobNo: j.no,
    createDate: j.createDate,
    createByName: j.createByName,
    status: j.status,
    jobType: j.jobType,
    jobTypeDetail: j.jobTypeDetail,
    isBounce: j.isBounce,
    so: j.so,
    channel: j.channel,
    shopName: j.shopName,
    saleOrderDate: j.saleOrderDate,
    warrantyMonth: String(j.warrantyMonth || ""),
    expireDate: j.expireDate,
    warranty: j.warranty,
    productType: j.productType,
    imei: j.imei,
    serial: j.serial,
    brand: j.brand,
    modelCode: j.modelCode,
    modelDetail: j.modelDetail,
    receptionDate: j.receptionDate,
    receptionTrackingNo: j.receptionTrackingNo,
    receptionShipper: j.receptionShipper,
    receptionType: j.receptionType || RECEIVE_METHODS[0],
    equipment: j.equipment,
    fault: j.fault,
    symptoms: j.symptoms,
    symptomOther: j.symptomOther,
    remark: j.remark,
    serviceCost: j.serviceCost,
    toolCost: j.toolCost,
    deliveryCost: j.deliveryCost,
    boxCost: j.boxCost,
    partsCost: j.partsCost,
    estimateCost: j.estimateCost ? String(j.estimateCost) : "",
    depositCost: j.depositCost ? String(j.depositCost) : "",
    engineerId: j.engineerId,
    engineerName: j.engineer,
    dueDate: j.dueDate,
  };
}

/** Body for POST /api/jobs and PATCH /api/jobs/:no */
export function toJobInput(s: JobFormState) {
  return {
    customerCode: s.customer?.code ?? "",
    jobType: s.jobType,
    jobTypeDetail: s.jobTypeDetail,
    isBounce: s.isBounce,
    status: s.status,
    so: s.so,
    channel: s.channel,
    shopName: s.shopName,
    saleOrderDate: s.saleOrderDate,
    warrantyMonth: s.warrantyMonth,
    expireDate: s.expireDate,
    warranty: s.warranty,
    productType: s.productType,
    imei: s.imei,
    serial: s.serial,
    brand: s.brand,
    modelCode: s.modelCode,
    modelDetail: s.modelDetail,
    receptionDate: s.receptionDate,
    receptionTrackingNo: s.receptionTrackingNo,
    receptionShipper: s.receptionShipper,
    receptionType: s.receptionType,
    equipment: s.equipment,
    fault: s.fault,
    symptoms: s.symptoms,
    symptomOther: s.symptomOther,
    remark: s.remark,
    serviceCost: s.serviceCost,
    toolCost: s.toolCost,
    deliveryCost: s.deliveryCost,
    boxCost: s.boxCost,
    estimateCost: s.estimateCost,
    depositCost: s.depositCost,
    engineerId: s.engineerId || undefined,
    engineerEmail: s.engineerEmail || undefined,
    engineerName: s.engineerName || undefined,
    dueDate: s.dueDate,
  };
}

/**
 * The job screens (บันทึกซ่อม / Out-Source / Swap-Refund / ปิดงาน) also show the
 * editable product / other-info / cost sections. Persist those through the
 * generic PATCH first so nothing typed there is lost; the page then posts its
 * own action. Skipped (not failed) when the user lacks "Job Management" edit.
 */
export async function saveCommonSections(jobNo: string, s: JobFormState, allowed: boolean) {
  if (!allowed) return;
  const body = toJobInput(s);
  await patchJson(`/api/jobs/${encodeURIComponent(jobNo)}`, { ...body, status: undefined });
}

type Ctx = {
  s: JobFormState;
  set: <K extends keyof JobFormState>(k: K, v: JobFormState[K]) => void;
  patch: (p: Partial<JobFormState>) => void;
  reset: (next?: JobFormState) => void;
};

const FormCtx = React.createContext<Ctx | null>(null);

export function JobFormProvider({
  initial,
  children,
}: {
  initial?: JobFormState;
  children: React.ReactNode;
}) {
  const [s, setS] = React.useState<JobFormState>(initial ?? EMPTY_JOB_FORM);
  const value = React.useMemo<Ctx>(
    () => ({
      s,
      set: (k, v) => setS((x) => ({ ...x, [k]: v })),
      patch: (p) => setS((x) => ({ ...x, ...p })),
      reset: (next) => setS(next ?? EMPTY_JOB_FORM),
    }),
    [s]
  );
  return <FormCtx.Provider value={value}>{children}</FormCtx.Provider>;
}

export function useJobForm(): Ctx {
  const ctx = React.useContext(FormCtx);
  if (!ctx) throw new Error("useJobForm must be used inside <JobFormProvider>");
  return ctx;
}

/* ---------------- lookup bar ---------------- */

export function JobLookupBar({
  label = "ระบุ หมายเลขงาน",
  placeholder = "J2612164",
  onFind,
  note,
  initial = "",
}: {
  label?: string;
  placeholder?: string;
  onFind?: (v: string) => void;
  note?: string;
  initial?: string;
}) {
  const [v, setV] = React.useState(initial);
  React.useEffect(() => setV(initial), [initial]);
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
  const { s, set } = useJobForm();
  const c = s.customer;
  return (
    <Section
      title="ข้อมูลลูกค้า"
      icon={UserRound}
      description={c ? "ข้อมูลกลางจากตารางลูกค้า (อ่านอย่างเดียว)" : "เลือก ลูกค้าเดิม เพื่อค้นหา หรือ ลูกค้าใหม่ เพื่อเพิ่มข้อมูลก่อนเปิดงาน"}
      actions={c && <Badge tone="success" dot>พบข้อมูลลูกค้า</Badge>}
    >
      <CustomerSelect value={c} onChange={(cust) => set("customer", cust)} readOnly={readOnly} />
    </Section>
  );
}

export function JobOpenSection({
  status,
  editable = true,
  jobNo,
}: {
  status?: string;
  editable?: boolean;
  jobNo?: string;
}) {
  const { s, set } = useJobForm();
  const { data: JOB_TYPES } = useJobTypes();
  const { data: JOB_TYPE_DETAILS } = useJobTypeDetails();
  const { name: me } = useAccess();
  const shownStatus = s.status || status || "งานใหม่";
  const [now, setNow] = React.useState("");
  React.useEffect(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    setNow(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
  }, []);
  return (
    <Section title="ข้อมูลการเปิดงาน" icon={ClipboardList}>
      <FieldGrid>
        <Field label="หมายเลขงาน">
          <ReadOnly>
            <span className="num">{s.jobNo || jobNo || "Generate Auto"}</span>
          </ReadOnly>
        </Field>
        <Field label="วันที่">
          <ReadOnly>
            <span className="num">{s.createDate || now} น.</span>
          </ReadOnly>
        </Field>
        <Field label="เปิดงานโดย">
          <ReadOnly>{s.createByName || me || "—"}</ReadOnly>
        </Field>
        <Field label="สถานะงาน">
          {editable ? (
            <Select value={shownStatus} onChange={(e) => set("status", e.target.value)}>
              {JOB_STATUS_OPTIONS.map((st) => (
                <option key={st}>{st}</option>
              ))}
              {!JOB_STATUS_OPTIONS.includes(shownStatus) && <option>{shownStatus}</option>}
            </Select>
          ) : (
            <ReadOnly>
              <Badge tone="info" dot>
                {shownStatus}
              </Badge>
            </ReadOnly>
          )}
        </Field>
        <Field label="ประเภทงานหลัก" required className="lg:col-span-2">
          <Select value={s.jobType} onChange={(e) => set("jobType", e.target.value)}>
            <option value="">- - Please Select - -</option>
            {JOB_TYPES.map((j) => (
              <option key={j.id}>{j.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="งานย่อย" className="lg:col-span-2">
          {/* ค่าที่ใช้ในระบบเดิมทั้ง 24 ค่า (job.job_type_detail) เป็นรายการแนะนำ + พิมพ์ค่าใหม่ได้ */}
          <Input
            list="job-type-detail-options"
            value={s.jobTypeDetail}
            onChange={(e) => set("jobTypeDetail", e.target.value)}
            placeholder="- - เลือกหรือพิมพ์ - -"
          />
          <datalist id="job-type-detail-options">
            {JOB_TYPE_DETAILS.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label="งานเด้ง" wide>
          <label className="flex h-9 w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={s.isBounce} onChange={(e) => set("isBounce", e.target.checked)} disabled={!editable} />
            สินค้าเครื่องนี้เคยเข้าซ่อมแล้วกลับมาซ้ำ (is_job_bounce)
          </label>
        </Field>
      </FieldGrid>
    </Section>
  );
}

/* ---------------- product info ---------------- */

export function ProductSection({ title = "ข้อมูลเกี่ยวกับสินค้า" }: { title?: string }) {
  const { s, set, patch } = useJobForm();
  const { data: SHIPPERS } = useShippers();
  const { data: PRODUCT_TYPES } = useProductTypes();
  const { data: MANUFACTURERS } = useManufacturers();
  const { data: MODELS } = useModels();
  const { data: SYMPTOMS } = useSymptoms();
  const { data: SYMPTOM_STATS } = useSymptomStats();
  const { data: MODEL_SYMPTOMS } = useModelSymptoms(s.modelCode);
  const symptoms = s.symptoms;

  // models of the chosen brand first (still allows any model)
  const modelOptions = React.useMemo(() => {
    const own = MODELS.filter((m) => !s.brand || m.brand === s.brand);
    return own.length ? own : MODELS;
  }, [MODELS, s.brand]);

  // expire date = sale order date + warranty months
  const recalcExpire = (saleDate: string, months: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return;
    const m = Number(months) || 0;
    const d = new Date(saleDate + "T00:00:00");
    d.setMonth(d.getMonth() + m);
    const p = (n: number) => String(n).padStart(2, "0");
    patch({ expireDate: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` });
  };

  return (
    <Section title={title} icon={PackageSearch}>
      <FieldGrid>
        <Field label="Sale Order No." required>
          <Input placeholder="SO2600760" className="num" value={s.so} onChange={(e) => set("so", e.target.value)} />
        </Field>
        <Field label="Channel" required>
          <Select value={s.channel} onChange={(e) => set("channel", e.target.value)}>
            <option value="">- - Please Select - -</option>
            {CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Shop Name">
          <Input placeholder="ชื่อร้านค้า" value={s.shopName} onChange={(e) => set("shopName", e.target.value)} />
        </Field>
        <Field label="Sale Order Date" required>
          <Input
            type="date"
            value={s.saleOrderDate}
            onChange={(e) => {
              set("saleOrderDate", e.target.value);
              recalcExpire(e.target.value, s.warrantyMonth);
            }}
          />
        </Field>

        <Field label="รับประกัน (เดือน)" required>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={s.warrantyMonth}
            onChange={(e) => {
              set("warrantyMonth", e.target.value);
              recalcExpire(s.saleOrderDate, e.target.value);
            }}
            onFocus={(e) => e.currentTarget.select()}
            className="num text-right"
          />
        </Field>
        <Field label="Expire Date" required>
          <Input type="date" value={s.expireDate} onChange={(e) => set("expireDate", e.target.value)} />
        </Field>
        <Field label="Warranty" required>
          <Select value={s.warranty} onChange={(e) => set("warranty", e.target.value)}>
            <option value="">- - Please Select - -</option>
            {WARRANTY_OPTIONS.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </Select>
        </Field>
        <Field label="ประเภทสินค้า">
          <Select value={s.productType} onChange={(e) => set("productType", e.target.value)}>
            <option value="">- - Please Select - -</option>
            {PRODUCT_TYPES.map((p) => (
              <option key={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Imei No.">
          <Input className="num" placeholder="35xxxxxxxxxxxxx" value={s.imei} onChange={(e) => set("imei", e.target.value)} />
        </Field>
        <Field label="Serial No." required>
          <Input className="num" placeholder="SN-XXXXXXXX" value={s.serial} onChange={(e) => set("serial", e.target.value)} />
        </Field>
        <Field label="ยี่ห้อ" required>
          <Select value={s.brand} onChange={(e) => set("brand", e.target.value)}>
            <option value="">- - Please Select - -</option>
            {MANUFACTURERS.map((m) => (
              <option key={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="รุ่น" required>
          <Select
            value={s.modelCode}
            onChange={(e) => {
              const m = MODELS.find((x) => x.code === e.target.value);
              patch({ modelCode: e.target.value, brand: m?.brand || s.brand });
            }}
          >
            <option value="">- - Please Select - -</option>
            {modelOptions.map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} — {m.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="รุ่นย่อย (ถ้ามี)">
          <Input value={s.modelDetail} onChange={(e) => set("modelDetail", e.target.value)} />
        </Field>
        <Field label="วันที่รับเข้า">
          <Input type="date" value={s.receptionDate} onChange={(e) => set("receptionDate", e.target.value)} />
        </Field>
        <Field label="เลขพัสดุจากลูกค้า">
          <Input className="num" value={s.receptionTrackingNo} onChange={(e) => set("receptionTrackingNo", e.target.value)} />
        </Field>
        <Field label="โดยบริษัทขนส่ง">
          {/* ระบบเดิมเป็นข้อความอิสระ — แนะนำจากค่าที่ใช้บ่อยใน DB (Flash, ไปรษณีย์, THAIPOST, KEX, J&T …) */}
          <Input
            list="shipper-options"
            value={s.receptionShipper}
            onChange={(e) => set("receptionShipper", e.target.value)}
            placeholder="- - เลือกหรือพิมพ์ - -"
          />
          <datalist id="shipper-options">
            {SHIPPERS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        <Field label="รับสินค้าเข้าโดย" wide>
          <div className="flex flex-wrap gap-4 rounded-md border border-border bg-muted/40 px-3 py-2">
            {RECEIVE_METHODS.map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
                <Radio name="receive-method" checked={s.receptionType === m} onChange={() => set("receptionType", m)} />
                {m}
              </label>
            ))}
          </div>
        </Field>

        <Field label="อุปกรณ์ (ที่นำส่ง)" className="lg:col-span-2">
          <Textarea rows={2} placeholder="เช่น อะแดปเตอร์, รีโมท, กล่อง" value={s.equipment} onChange={(e) => set("equipment", e.target.value)} />
        </Field>
        <Field label="จุดตำหนิ" className="lg:col-span-2">
          <Textarea rows={2} placeholder="รอยขีดข่วน / รอยบุบ ฯลฯ" value={s.fault} onChange={(e) => set("fault", e.target.value)} />
        </Field>

        <Field
          label="อาการเสียหลัก (มาตรฐาน)"
          required
          wide
          hint={symptoms.length ? `เลือกแล้ว ${symptoms.length} อาการ · ★ ${symptoms[0]} = อาการหลัก` : "ค้นหาแล้วติ๊กได้หลายอาการ · ตัวแรกที่เลือกเป็นอาการหลัก"}
        >
          {/* searchable multi-select, ordered by real usage; top symptoms of the chosen model on top */}
          <SymptomPicker
            value={symptoms}
            onChange={(names) => set("symptoms", names)}
            options={SYMPTOM_STATS.length ? SYMPTOM_STATS : SYMPTOMS.map((sy) => ({ id: Number(sy.id), name: sy.name }))}
            suggested={MODEL_SYMPTOMS}
            suggestedLabel={s.modelCode ? `อาการที่พบบ่อยของรุ่น ${MODELS.find((m) => m.code === s.modelCode)?.name ?? s.modelCode}` : "อาการที่พบบ่อย"}
          />
        </Field>

        <Field label="อาการเสีย (อื่นๆ)" className="lg:col-span-2">
          <Textarea rows={2} value={s.symptomOther} onChange={(e) => set("symptomOther", e.target.value)} />
        </Field>
        <Field label="หมายเหตุ" className="lg:col-span-2">
          <Textarea rows={2} value={s.remark} onChange={(e) => set("remark", e.target.value)} />
        </Field>
      </FieldGrid>
    </Section>
  );
}

/* ---------------- cost summary ---------------- */

const COST_FIELDS = [
  { key: "serviceCost", label: "ค่าบริการการซ่อม" },
  { key: "toolCost", label: "ค่าเครื่องมือพิเศษ" },
  { key: "deliveryCost", label: "ค่าขนส่ง" },
  { key: "boxCost", label: "ค่ากล่องพัสดุ" },
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

export function CostSummary({ partsTotal }: { partsTotal?: number }) {
  const { s, set } = useJobForm();
  const parts = partsTotal ?? s.partsCost;
  const net = parts + s.serviceCost + s.toolCost + s.deliveryCost + s.boxCost;

  return (
    <Section title="สรุปค่าใช้จ่าย" icon={Coins}>
      <div className="ml-auto max-w-xl space-y-2">
        <CostRow label="รวมค่าอะไหล่">
          <div className="num flex h-9 items-center justify-end rounded-md border border-border bg-muted/60 px-3 text-right text-sm">
            {baht(parts)}
          </div>
        </CostRow>

        {COST_FIELDS.map((f) => (
          <CostRow key={f.key} label={f.label}>
            <input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              value={s[f.key] === 0 ? "" : s[f.key]}
              placeholder="0.00"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => set(f.key, Number(e.target.value) || 0)}
              className="num h-9 w-full rounded-md border border-input bg-card px-3 text-right text-sm outline-hidden transition-colors placeholder:text-muted-foreground/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
  const { s, set, patch } = useJobForm();
  const { data: STAFF } = useStaff();
  // "มอบหมายงานนี้ให้" = job.engineer_id → a person in app_user. The directory
  // picker is kept for lookup; the assignment itself must map to app_user.
  const [assignee, setAssignee] = React.useState<Person | null>(null);
  const pick = (p: Person | null) => {
    setAssignee(p);
    if (!p) return;
    const hit = STAFF.find((st) => st.name === p.name);
    // known staff → id; otherwise the server resolves/creates app_user by email
    patch({ engineerId: hit?.id ?? 0, engineerName: p.name, engineerEmail: hit ? "" : p.email });
  };
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
            value={s.estimateCost}
            onChange={(e) => set("estimateCost", e.target.value)}
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
            value={s.depositCost}
            onChange={(e) => set("depositCost", e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            className="num text-right"
          />
        </Field>
        {showTech && (
          <Field label="มอบหมายงานนี้ให้" hint="เลือกช่างจากรายชื่อผู้ใช้ระบบ หรือค้นหาจากไดเรกทอรีกลาง">
            <div className="space-y-2">
              <Select
                value={s.engineerId ? String(s.engineerId) : ""}
                onChange={(e) => {
                  const id = Number(e.target.value) || 0;
                  patch({ engineerId: id, engineerName: STAFF.find((st) => st.id === id)?.name ?? "" });
                }}
              >
                <option value="">- - ยังไม่ระบุ - -</option>
                {STAFF.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                    {st.userType ? ` (${st.userType})` : ""}
                  </option>
                ))}
              </Select>
              <PeoplePicker value={assignee} onChange={pick} />
            </div>
          </Field>
        )}
        <Field label="วันประเมินซ่อมเสร็จ">
          <Input type="date" value={s.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
      </FieldGrid>
    </Section>
  );
}

export const AttachmentSection = React.forwardRef<AttachmentsHandle, { jobNo?: string }>(function AttachmentSection(
  { jobNo },
  ref
) {
  return (
    <Section title="เอกสารแนบ" icon={Paperclip}>
      <Attachments ref={ref} jobNo={jobNo} />
    </Section>
  );
});
export type { AttachmentsHandle };

export function FormActions({
  onSave,
  saveLabel = "บันทึกข้อมูล",
  extra,
  saving = false,
  onCancel,
}: {
  onSave: () => void;
  saveLabel?: string;
  extra?: React.ReactNode;
  saving?: boolean;
  onCancel?: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-3 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/90 px-3 py-3 backdrop-blur-md sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6 no-print">
      {extra}
      <Button variant="outline" size="md" type="button" onClick={onCancel ?? (() => window.history.back())}>
        ยกเลิก
      </Button>
      <Button size="md" onClick={onSave} disabled={saving}>
        {saveLabel}
      </Button>
    </div>
  );
}

export function ConfirmCheckbox({ label, checked, onChange }: { label: string; checked?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <Checkbox checked={checked} onChange={(e) => onChange?.(e.target.checked)} />
      {label}
    </label>
  );
}
