'use client';

import * as React from 'react';
import { Search, UserRound, ClipboardList, PackageSearch, Coins, Paperclip, TriangleAlert, Lock } from 'lucide-react';
import { Section } from './section';
import { SymptomPicker } from './symptom-picker';
import { SearchSelect, withCurrent } from './search-select';
import { CustomerSelect } from './customer-select';
import { ProfileSelect } from './profile-select';
import { Attachments, type AttachmentsHandle, type AttachmentsProps } from './attachments';
import {
  BrandField,
  ChannelField,
  ExpireField,
  ImeiField,
  ModelDetailField,
  ModelField,
  NoteField,
  ProductTypeField,
  ReceptionDateField,
  ReceptionTypeField,
  SaleDateField,
  SerialField,
  ShipperField,
  ShopPlainField,
  ShopSuggestField,
  SoField,
  TrackingField,
  WarrantyField,
  WarrantyMonthField,
} from '@/components/jobs/product-fields';
import { Button } from '@/components/ui/button';
import { Field, FieldGrid, ReadOnly } from '@/components/ui/field';
import { Input, Checkbox } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm';
import { RECEIVE_METHODS } from '@/data/options';
import type { Customer } from '@/data/types';
import {
  useJobTypes,
  useJobTypeDetails,
  useSymptomStats,
  useModelSymptoms,
  useModels,
  useSymptoms,
  useStaff,
} from '@/data/db';
import { baht, cn } from '@/lib/utils';
import { patchJson, isStale, errMsg } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAccess } from '@/lib/use-access';
import { RIGHTS } from '@/lib/modules';
import type { JobDetail } from '@/lib/use-job';
import { useFormErrors, apiFieldErrors } from '@/lib/use-form-errors';
import type { z } from 'zod';
import {
  jobSchema,
  filledRequired,
  missingRequired,
  jobBalance,
  JOB_FIELD_LABEL,
  MONEY_LOCKED,
  type JobCheck,
  type JobRequiredKey,
} from '@/lib/validation/job';
import type { FieldErrors } from '@/lib/validation';
import { useMountTime } from '@/lib/use-client';
import { isoDateTime } from '@/lib/dates';
import { useLeave, useUnsavedChanges } from '@/lib/use-unsaved-changes';

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
  /** Pending / Repaired / Finished / Cancel — Finished locks the money fields (useMoneyLock) */
  statusGroup: string;
  jobType: string;
  jobTypeDetail: string;
  isBounce: boolean; // งานเด้ง (job.is_job_bounce)
  documentProfileId: number; // ออกเอกสารในนาม (0 = default)
  so: string;
  channel: string;
  shopName: string;
  saleOrderDate: string;
  warrantyMonth: string;
  expireDate: string;
  warranty: string;
  /** Warranty was filled in from the expire date (the user has not picked it) — it keeps following it */
  warrantyAuto: boolean;
  productType: string;
  imei: string;
  serial: string;
  brand: string;
  modelCode: string;
  /** the stored model's name — shown while the model lists load (not sent: the API takes the code) */
  modelName: string;
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
  /** the user confirmed giving the job (it had an engineer) to someone else — sent as takeOver */
  takeOver: boolean;
  dueDate: string;
  /** the due date shown is opened + the job type's SLA (nobody picked one yet) */
  dueDateAuto: boolean;
  /** job.row_version as loaded — sent back so a save over someone else's newer edit is refused (409) */
  version: number;
};

export const EMPTY_JOB_FORM: JobFormState = {
  customer: null,
  jobNo: '',
  createDate: '',
  createByName: '',
  status: 'งานใหม่',
  statusGroup: '',
  jobType: '',
  jobTypeDetail: '',
  isBounce: false,
  documentProfileId: 0,
  so: '',
  channel: '',
  shopName: '',
  saleOrderDate: '',
  warrantyMonth: '12',
  expireDate: '',
  warranty: '',
  warrantyAuto: false,
  productType: '',
  imei: '',
  serial: '',
  brand: '',
  modelCode: '',
  modelName: '',
  modelDetail: '',
  receptionDate: '',
  receptionTrackingNo: '',
  receptionShipper: '',
  receptionType: RECEIVE_METHODS[0],
  equipment: '',
  fault: '',
  symptoms: [],
  symptomOther: '',
  remark: '',
  serviceCost: 0,
  toolCost: 0,
  deliveryCost: 0,
  boxCost: 0,
  partsCost: 0,
  estimateCost: '',
  depositCost: '',
  engineerId: 0,
  engineerName: '',
  takeOver: false,
  dueDate: '',
  dueDateAuto: false,
  version: 0,
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
          status: 'Active',
          id: j.customer.id,
        }
      : null,
    jobNo: j.no,
    createDate: j.createDate,
    createByName: j.createByName,
    status: j.status,
    statusGroup: j.statusGroup,
    jobType: j.jobType,
    jobTypeDetail: j.jobTypeDetail,
    isBounce: j.isBounce,
    documentProfileId: j.documentProfileId,
    so: j.so,
    channel: j.channel,
    shopName: j.shopName,
    saleOrderDate: j.saleOrderDate,
    warrantyMonth: j.warrantyMonth == null ? '' : String(j.warrantyMonth), // 0 months is a value (the API keeps it required)
    expireDate: j.expireDate,
    warranty: j.warranty,
    productType: j.productType,
    imei: j.imei,
    serial: j.serial,
    brand: j.brand,
    modelCode: j.modelCode,
    modelName: j.modelName,
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
    estimateCost: j.estimateCost ? String(j.estimateCost) : '',
    depositCost: j.depositCost ? String(j.depositCost) : '',
    engineerId: j.engineerId,
    engineerName: j.engineer,
    dueDate: j.dueDate,
    dueDateAuto: j.dueDateAuto,
    version: j.version,
  };
}

/** Body for POST /api/jobs and PATCH /api/jobs/:no */
export function toJobInput(s: JobFormState) {
  return {
    customerCode: s.customer?.code ?? '',
    jobType: s.jobType,
    jobTypeDetail: s.jobTypeDetail,
    documentProfileId: s.documentProfileId || undefined,
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
    engineerId: s.engineerId, // 0 = มอบหมายงานนี้ให้ cleared: the job has nobody on it (updateJob)
    engineerName: s.engineerName || undefined,
    takeOver: s.takeOver || undefined,
    dueDate: s.dueDate,
    version: s.version, // ignored by a create
  };
}

/**
 * The job screens (บันทึกซ่อม / Out-Source / Swap-Refund / ปิดงาน) also show the
 * editable product / other-info / cost sections. Persist those through the
 * generic PATCH first so nothing typed there is lost; the page then posts its
 * own action. Skipped (not failed) when the user lacks "Job Management" edit.
 */
export async function saveCommonSections(
  jobNo: string,
  s: JobFormState,
  allowed: boolean,
): Promise<Partial<JobFormState>> {
  if (!allowed) return {};
  const body = toJobInput(s);
  const d = await patchJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(jobNo)}`, {
    ...body,
    status: undefined,
  });
  // the page `adopt`s this: if its own action then fails, a second try must not trip over our own save
  return { version: d.job.version };
}

type Ctx = {
  s: JobFormState;
  set: <K extends keyof JobFormState>(k: K, v: JobFormState[K]) => void;
  patch: (p: Partial<JobFormState>) => void;
  /** values that are already stored (a default pre-picked, a field saved on the spot) — not an edit */
  adopt: (p: Partial<JobFormState>) => void;
  /** a job loaded / saved (or an empty form) — also what "unsaved edits" is measured against */
  reset: (next?: JobFormState) => void;
  /** the form as last loaded / saved */
  loaded: JobFormState;
  /** field errors by JobInput key (shown under the fields) */
  errors: FieldErrors;
  /**
   * Check the form before saving (src/lib/validation/job.ts): a new job needs every required field;
   * a loaded job must keep the ones it already had. Shows the errors; returns them ({} = OK).
   */
  validate: () => FieldErrors;
  /** toast + focus the first bad field (also for errors a page adds of its own) */
  report: (e: FieldErrors, title?: string) => boolean;
  /** API 400 with field errors → under the fields */
  fromApi: (err: unknown) => boolean;
  /** required fields the loaded job was saved without (old data) — null for a new job */
  incomplete: JobRequiredKey[] | null;
};

/** JobFormState key → the JobInput key its error is reported under */
const errorKey = (k: keyof JobFormState): string => (k === 'customer' ? 'customerCode' : k);

const FormCtx = React.createContext<Ctx | null>(null);

/** a job screen's page: the form state + the Suspense useJob's useSearchParams needs.
 *  `initial`: the form built from the job that came with the page (fromJob), so the server HTML is the filled form */
export function JobScreen({ initial, children }: { initial?: JobFormState; children: React.ReactNode }) {
  return (
    <JobFormProvider initial={initial}>
      <React.Suspense fallback={null}>{children}</React.Suspense>
    </JobFormProvider>
  );
}

export function JobFormProvider({ initial, children }: { initial?: JobFormState; children: React.ReactNode }) {
  const [s, setS] = React.useState<JobFormState>(initial ?? EMPTY_JOB_FORM);
  // the form as last loaded / saved — anything else on screen is an unsaved edit
  const [saved, setSaved] = React.useState<JobFormState>(initial ?? EMPTY_JOB_FORM);
  const dirty = React.useMemo(() => JSON.stringify(s) !== JSON.stringify(saved), [s, saved]);
  useUnsavedChanges(dirty);
  const { errors, setErrors, run, clear, report, fromApi } = useFormErrors();
  // the job as loaded ("never worse"): the required fields it had + its values (an unchanged legacy
  // value passes the format rules) + its open date; null = new job (all required, opened today)
  const baselineOf = (f: JobFormState): { keep: JobRequiredKey[]; check: JobCheck } | null =>
    f.jobNo
      ? { keep: filledRequired(toJobInput(f)), check: { prev: toJobInput(f), openDate: f.createDate.slice(0, 10) } }
      : null;
  const [baseline, setBaseline] = React.useState(() => baselineOf(initial ?? EMPTY_JOB_FORM));
  const value = React.useMemo<Ctx>(
    () => ({
      s,
      set: (k, v) => {
        setS((x) => ({ ...x, [k]: v }));
        clear(errorKey(k));
      },
      patch: (p) => {
        setS((x) => ({ ...x, ...p }));
        Object.keys(p).forEach((k) => clear(errorKey(k as keyof JobFormState)));
      },
      adopt: (p) => {
        setS((x) => ({ ...x, ...p }));
        setSaved((x) => ({ ...x, ...p }));
      },
      reset: (next) => {
        const f = next ?? EMPTY_JOB_FORM;
        setS(f);
        setSaved(f);
        setBaseline(baselineOf(f));
        setErrors({});
      },
      loaded: saved,
      errors,
      validate: () => run(jobSchema(baseline?.keep, baseline?.check), toJobInput(s)),
      report,
      fromApi,
      incomplete: baseline ? missingRequired(toJobInput(s)).filter((k) => !baseline.keep.includes(k)) : null,
    }),
    [s, saved, errors, baseline, run, clear, report, fromApi, setErrors],
  );
  return <FormCtx.Provider value={value}>{children}</FormCtx.Provider>;
}

/**
 * Workflow screens (บันทึกซ่อม / Out-Source / Swap-Refund / ปิดงาน): check the shared job sections
 * (when this user may edit them) and the screen's own action payload together, so every missing
 * field shows at once. Action errors are keyed by payload path ("status", "send.to", "return.date").
 */
/** `reload`: read the same job again (the page's `find(job.no)`) — a stale-save 409's "โหลดใหม่" uses it
 *  instead of reloading the browser page, which lost the job found through the search bar */
export function useWorkflowErrors(reload?: () => void) {
  const form = useJobForm();
  const action = useFormErrors();
  const { push } = useToast();
  const { validate, report } = form;
  const { run } = action;
  /** true = OK to save */
  const check = React.useCallback(
    <S extends z.ZodType>(schema: S, body: unknown, jobEditable: boolean) =>
      !report({ ...(jobEditable ? validate() : {}), ...run(schema, body) }),
    [validate, report, run],
  );
  const fromApi = React.useCallback(
    (err: unknown) => {
      if (reload && isStale(err)) {
        push({
          kind: 'error',
          title: errMsg(err),
          desc: 'ระบบไม่บันทึก เพื่อไม่ให้ทับการแก้ไขนั้น — "โหลดใหม่" ดึงข้อมูลล่าสุดของงานนี้มาแทนข้อความที่ยังไม่ได้บันทึก (คัดลอกเก็บไว้ก่อนถ้าต้องการ)',
          action: { label: 'โหลดใหม่', onClick: reload },
        });
        return true;
      }
      const f = apiFieldErrors(err);
      if (!f) return form.fromApi(err); // a stale-version 409 (reload toast); false otherwise
      action.setErrors(f);
      form.fromApi(err);
      return true;
    },
    [action, form, reload, push],
  );
  return { errors: action.errors, clear: action.clear, check, fromApi };
}

export function useJobForm(): Ctx {
  const ctx = React.useContext(FormCtx);
  if (!ctx) throw new Error('useJobForm must be used inside <JobFormProvider>');
  return ctx;
}

/** why the money fields are read-only: a closed job and no Job Money After Close (the API refuses a change) */
export function useMoneyLock(): string | undefined {
  const { s } = useJobForm();
  const { has } = useAccess();
  return s.statusGroup === 'Finished' && !has('Job Money After Close') ? MONEY_LOCKED : undefined;
}

/* ---------------- lookup bar ---------------- */

export function JobLookupBar({
  label = 'ระบุ หมายเลขงาน',
  placeholder = 'J2612164',
  onFind,
  note,
  initial = '',
  id,
}: {
  /** id for the input (so <RecordGate> can focus it) */
  id?: string;
  label?: string;
  placeholder?: string;
  onFind?: (v: string) => void;
  note?: string;
  initial?: string;
}) {
  // the box follows a new `initial` from the page (adjusted while rendering); typing edits it freely
  const [v, setV] = React.useState(initial);
  const [vFrom, setVFrom] = React.useState(initial);
  if (initial !== vFrom) {
    setVFrom(initial);
    setV(initial);
  }
  const autoId = React.useId();
  const inputId = id ?? autoId;
  return (
    <div className="surface flex flex-wrap items-center gap-3 p-3 no-print">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label} :
      </label>
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Input
          id={inputId}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onFind?.(v)}
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
  const { s, set, errors } = useJobForm();
  const c = s.customer;
  return (
    <Section
      title="ข้อมูลลูกค้า"
      icon={UserRound}
      description={
        c
          ? 'ข้อมูลกลางจากตารางลูกค้า (อ่านอย่างเดียว)'
          : 'เลือก ลูกค้าเดิม เพื่อค้นหา หรือ ลูกค้าใหม่ เพื่อเพิ่มข้อมูลก่อนเปิดงาน'
      }
      actions={
        c && (
          <Badge tone="success" dot>
            พบข้อมูลลูกค้า
          </Badge>
        )
      }
    >
      <Field error={errors.customerCode}>
        <CustomerSelect value={c} onChange={(cust) => set('customer', cust)} readOnly={readOnly} />
      </Field>
    </Section>
  );
}

/** เปิดงานใหม่ / แก้ไขข้อมูลงาน — status is shown only; it changes through the workflow screens (บันทึกซ่อม / ปิดงาน …). */
export function JobOpenSection({ status, jobNo }: { status?: string; jobNo?: string }) {
  const { s, set, adopt, errors } = useJobForm();
  const { data: JOB_TYPES, ...jobTypesLookup } = useJobTypes();
  const { data: JOB_TYPE_DETAILS, ...typeDetailsLookup } = useJobTypeDetails();
  const { name: me } = useAccess();
  const shownStatus = s.status || status || 'งานใหม่';
  // a new job's "วันที่" preview: the moment the screen opened, Thai time (the server stamps the real one)
  const openedAt = useMountTime();
  const now = openedAt ? isoDateTime(openedAt, { seconds: true }) : '';
  return (
    <Section title="ข้อมูลการเปิดงาน" icon={ClipboardList}>
      <FieldGrid>
        <Field label="หมายเลขงาน">
          <ReadOnly>
            <span className="num">{s.jobNo || jobNo || 'Generate Auto'}</span>
          </ReadOnly>
        </Field>
        <ProfileSelect
          value={s.documentProfileId}
          onChange={(id, how) => (how === 'user' ? set('documentProfileId', id) : adopt({ documentProfileId: id }))}
          doc={s.jobNo || jobNo ? { kind: 'job', no: s.jobNo || jobNo || '' } : undefined}
        />
        <Field label="วันที่">
          <ReadOnly>
            <span className="num">{s.createDate || now} น.</span>
          </ReadOnly>
        </Field>
        <Field label="เปิดงานโดย">
          <ReadOnly>{s.createByName || me || '—'}</ReadOnly>
        </Field>
        <Field label="สถานะงาน">
          <ReadOnly>
            <Badge tone="info" dot>
              {shownStatus}
            </Badge>
          </ReadOnly>
        </Field>
        <Field label="ประเภทงานหลัก" required error={errors.jobType} className="lg:col-span-2" lookup={jobTypesLookup}>
          <SearchSelect
            value={s.jobType}
            onChange={(v) => set('jobType', v)}
            options={withCurrent(
              JOB_TYPES.map((j) => ({ value: j.name, label: j.name })),
              s.jobType,
            )}
          />
        </Field>
        <Field label="งานย่อย" className="lg:col-span-2" error={errors.jobTypeDetail} lookup={typeDetailsLookup}>
          {/* ค่าที่ใช้ในระบบเดิมทั้ง 24 ค่า (job.job_type_detail) เป็นรายการแนะนำ + พิมพ์ค่าใหม่ได้ */}
          <Input
            list="job-type-detail-options"
            maxLength={50}
            value={s.jobTypeDetail}
            onChange={(e) => set('jobTypeDetail', e.target.value)}
            placeholder="- - เลือกหรือพิมพ์ - -"
          />
          <datalist id="job-type-detail-options">
            {JOB_TYPE_DETAILS.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label="งานเด้ง" wide group="group">
          <label className="flex h-9 w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={s.isBounce} onChange={(e) => set('isBounce', e.target.checked)} />
            สินค้าเครื่องนี้เคยเข้าซ่อมแล้วกลับมาซ้ำ
          </label>
        </Field>
      </FieldGrid>
    </Section>
  );
}

/* ---------------- product info ---------------- */

/** a symptom picker's lists (by usage, else the plain list; the model's common ones on top) — read once the
 *  picker is first focused / pressed, not with the page: the chosen symptoms show from the form meanwhile */
export function useSymptomLists(modelCode: string) {
  const [wanted, setWanted] = React.useState(false);
  const symptoms = useSymptoms('active', wanted);
  const stats = useSymptomStats(wanted);
  const { data: suggested } = useModelSymptoms(modelCode, wanted);
  const options = stats.data.length ? stats.data : symptoms.data.map((sy) => ({ id: Number(sy.id), name: sy.name }));
  return {
    // empty only when both failed
    lookup: {
      error: options.length ? null : (stats.error ?? symptoms.error),
      refetch: () => {
        stats.refetch();
        symptoms.refetch();
      },
    },
    picker: {
      options,
      suggested,
      loading: !options.length && (stats.loading || symptoms.loading),
      onWant: () => setWanted(true),
    },
  };
}

/** อาการเสียหลัก (มาตรฐาน) — searchable multi-select bound to the form's symptoms (first = main);
 *  ordered by real usage, with the chosen model's common symptoms on top. Used by ProductSection
 *  and the Out-Source "รายละเอียดการซ่อม" tab. */
export function MainSymptomField() {
  const { s, set, errors } = useJobForm();
  // the model's name below: the brand's list ModelField reads anyway (no brand → its code)
  const { data: MODELS } = useModels('active', { brand: s.brand, enabled: !!s.brand });
  const lists = useSymptomLists(s.modelCode);
  const symptoms = s.symptoms;
  return (
    <Field
      label="อาการเสียหลัก (มาตรฐาน)"
      required
      wide
      error={errors.symptoms}
      lookup={lists.lookup}
      hint={
        symptoms.length
          ? `เลือกแล้ว ${symptoms.length} อาการ · ★ ${symptoms[0]} = อาการหลัก`
          : 'ค้นหาแล้วติ๊กได้หลายอาการ · ตัวแรกที่เลือกเป็นอาการหลัก'
      }
    >
      <SymptomPicker
        value={symptoms}
        onChange={(names) => set('symptoms', names)}
        {...lists.picker}
        suggestedLabel={
          s.modelCode
            ? `อาการที่พบบ่อยของรุ่น ${MODELS.find((m) => m.code === s.modelCode)?.name ?? s.modelCode}`
            : 'อาการที่พบบ่อย'
        }
      />
    </Field>
  );
}

/**
 * Layouts (fields a layout hides keep their loaded values, so saving never clears them):
 *  - `full`   ปิดงาน — every field
 *  - `open`   เปิดงานใหม่ / แก้ไขข้อมูลงาน — no ประเภทสินค้า; Shop Name suggestions,
 *             courier from โปรไฟล์บริษัทขนส่ง
 *  - `repair` บันทึกงานซ่อม / บันทึกงานส่งซ่อมต่อ (Out-Source) / Swap-Refund — device fields only (no shop / reception)
 */
export function ProductSection({
  title = 'ข้อมูลเกี่ยวกับสินค้า',
  variant = 'full',
}: {
  title?: string;
  variant?: 'full' | 'open' | 'repair';
}) {
  const f = useJobForm();
  const { incomplete } = f;
  // an old job saved before these fields were required: it can still be saved, but say what is missing
  const incompleteNotice = incomplete && incomplete.length > 0 && (
    <p
      role="status"
      className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning"
    >
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        ข้อมูลงานนี้ยังไม่ครบ {incomplete.length} ช่อง: {incomplete.map((k) => JOB_FIELD_LABEL[k]).join(', ')} —
        บันทึกได้ตามปกติ แต่ควรเติมให้ครบ
      </span>
    </p>
  );
  // every layout ends with the same notes + symptoms
  const notes = (
    <>
      <NoteField
        f={f}
        k="equipment"
        label="อุปกรณ์ (ที่นำส่ง)"
        maxLength={100}
        placeholder="เช่น อะแดปเตอร์, รีโมท, กล่อง"
      />
      <NoteField f={f} k="fault" label="จุดตำหนิ" maxLength={100} placeholder="รอยขีดข่วน / รอยบุบ ฯลฯ" />
      <MainSymptomField />
      <NoteField f={f} k="symptomOther" label="อาการเสีย (อื่นๆ)" maxLength={200} />
      <NoteField f={f} k="remark" label="หมายเหตุ" maxLength={2000} />
    </>
  );

  if (variant === 'open')
    return (
      <Section title={title} icon={PackageSearch}>
        {incompleteNotice}
        <FieldGrid>
          <SoField f={f} />
          <ChannelField f={f} />
          <ShopSuggestField f={f} />
          <SaleDateField f={f} />

          <WarrantyMonthField f={f} />
          <ImeiField f={f} />
          <SerialField f={f} />
          <ExpireField f={f} />

          <WarrantyField f={f} />
          <BrandField f={f} />
          <ModelField f={f} />
          <ModelDetailField f={f} />

          <ReceptionTypeField f={f} />
          <ReceptionDateField f={f} />
          <TrackingField f={f} />
          <ShipperField f={f} />
          <div className="hidden lg:block" aria-hidden />

          {notes}
        </FieldGrid>
      </Section>
    );

  if (variant === 'repair')
    return (
      <Section title={title} icon={PackageSearch}>
        {incompleteNotice}
        <FieldGrid>
          <SoField f={f} />
          <ChannelField f={f} repair />
          <SaleDateField f={f} />
          <WarrantyMonthField f={f} />

          <ImeiField f={f} />
          <SerialField f={f} />
          <ExpireField f={f} />
          <WarrantyField f={f} />

          <BrandField f={f} />
          <ModelField f={f} />
          <ModelDetailField f={f} />
          <div className="hidden lg:block" aria-hidden />

          {notes}
        </FieldGrid>
      </Section>
    );

  return (
    <Section title={title} icon={PackageSearch}>
      {incompleteNotice}
      <FieldGrid>
        <SoField f={f} />
        <ChannelField f={f} />
        <ShopPlainField f={f} />
        <SaleDateField f={f} />

        <WarrantyMonthField f={f} />
        <ExpireField f={f} />
        <WarrantyField f={f} />
        <ProductTypeField f={f} />

        <ImeiField f={f} />
        <SerialField f={f} />
        <BrandField f={f} />
        <ModelField f={f} />

        <ModelDetailField f={f} />
        <ReceptionDateField f={f} />
        <TrackingField f={f} />
        <ShipperField f={f} />

        <ReceptionTypeField f={f} />

        {notes}
      </FieldGrid>
    </Section>
  );
}

/* ---------------- cost summary ---------------- */

const COST_FIELDS = [
  { key: 'serviceCost', label: 'ค่าบริการการซ่อม' },
  { key: 'toolCost', label: 'ค่าเครื่องมือพิเศษ' },
  { key: 'deliveryCost', label: 'ค่าขนส่ง' },
  { key: 'boxCost', label: 'ค่ากล่องพัสดุ' },
] as const;

/** One label : value : บาท row, stacked so the running total reads top-to-bottom. */
function CostRow({
  label,
  htmlFor,
  children,
  strong,
}: {
  label: string;
  /** id of the input in this row, so the label names it */
  htmlFor?: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  const Tag = htmlFor ? 'label' : 'span';
  return (
    <div className="flex items-center justify-end gap-3">
      <Tag
        htmlFor={htmlFor}
        className={cn(
          'w-40 shrink-0 text-right text-sm sm:w-48',
          strong ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
      >
        {label} :
      </Tag>
      <div className="w-36 shrink-0 sm:w-44">{children}</div>
      <span className={cn('w-8 shrink-0 text-sm', strong ? 'font-medium' : 'text-muted-foreground')}>บาท</span>
    </div>
  );
}

/** `action`: the screen's own payload errors (บันทึกซ่อม sends the costs too) — shown with the form's own */
export function CostSummary({
  partsTotal,
  action,
}: {
  partsTotal?: number;
  action?: { errors: FieldErrors; clear: (key: string) => void };
}) {
  const { s, set, errors } = useJobForm();
  const lock = useMoneyLock();
  const parts = partsTotal ?? s.partsCost;
  const net = parts + s.serviceCost + s.toolCost + s.deliveryCost + s.boxCost;
  const deposit = Number(s.depositCost) || 0;
  const bal = jobBalance(net, deposit, 0);

  return (
    <Section title="สรุปค่าใช้จ่าย" icon={Coins}>
      <div className="ml-auto max-w-xl space-y-2">
        <CostRow label="รวมค่าอะไหล่">
          <div className="num flex h-9 items-center justify-end rounded-md border border-border bg-muted/60 px-3 text-right text-sm">
            {baht(parts)}
          </div>
        </CostRow>

        {COST_FIELDS.map((f) => {
          const error = action?.errors[f.key] ?? errors[f.key];
          return (
            <div key={f.key}>
              <CostRow label={f.label} htmlFor={`cost-${f.key}`}>
                <input
                  id={`cost-${f.key}`}
                  type="number"
                  step="0.01"
                  min={0}
                  inputMode="decimal"
                  value={s[f.key] === 0 ? '' : s[f.key]}
                  disabled={!!lock}
                  placeholder="0.00"
                  aria-invalid={!!error || undefined}
                  aria-describedby={error ? `cost-${f.key}-error` : undefined}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    set(f.key, Number(e.target.value) || 0);
                    action?.clear(f.key);
                  }}
                  className="num h-9 w-full rounded-md border border-input bg-card px-3 text-right text-sm outline-hidden transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:bg-muted/60"
                />
              </CostRow>
              {error && (
                <p id={`cost-${f.key}-error`} role="alert" className="mt-1 text-right text-2xs text-danger">
                  {error}
                </p>
              )}
            </div>
          );
        })}

        <div className="border-t border-border pt-2.5">
          <CostRow label="รวมเป็นเงินสุทธิ" strong>
            <div className="num flex h-10 items-center justify-end rounded-md border border-primary/30 bg-primary-soft px-3 text-base font-semibold text-primary">
              {baht(net)}
            </div>
          </CostRow>
        </div>
        {/* the deposit was taken at reception — what is left to pay at close */}
        {deposit > 0 && (
          <>
            <CostRow label="หักเงินมัดจำ">
              <div className="num px-3 text-right text-sm">-{baht(deposit)}</div>
            </CostRow>
            {/* a deposit larger than the total (not repaired) goes back to the customer */}
            <CostRow label={bal.refund > 0 ? 'ต้องคืนเงินมัดจำ' : 'ยอดที่ต้องชำระ'} strong>
              <div className="num px-3 text-right text-base font-semibold">{baht(bal.refund || bal.due)}</div>
            </CostRow>
          </>
        )}
        {lock && (
          <p role="note" className="flex items-center justify-end gap-1.5 text-2xs text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden />
            {lock}
          </p>
        )}
      </div>
    </Section>
  );
}

/* ---------------- other info ---------------- */

export function OtherInfoSection({ showTech = true }: { showTech?: boolean }) {
  const { s, set, patch, errors, loaded } = useJobForm();
  const lock = useMoneyLock();
  const confirm = useConfirm();
  const { data: STAFF, ...staffLookup } = useStaff();
  // "มอบหมายงานนี้ให้" = job.engineer_id → an active user whose role has Job Take (the API refuses anyone else)
  const staffOptions = React.useMemo(() => {
    const opts = STAFF.filter((st) => st.takesJobs).map((st) => ({
      value: String(st.id),
      label: st.name,
      sub: st.userType || undefined,
    }));
    // the job's own assignee who is not on that list (left / another role) → still shown, may stay
    const own = loaded.engineerId;
    if (own > 0 && !opts.some((o) => o.value === String(own)))
      opts.unshift({
        value: String(own),
        label: loaded.engineerName || `#${own}`,
        sub: 'ผู้รับงานเดิม (ไม่อยู่ในรายชื่อช่างปัจจุบัน)',
      });
    return opts;
  }, [STAFF, loaded.engineerId, loaded.engineerName]);
  // the list follows the right, not a role name: say which right — and the roles that hold it now
  const takerRoles = [...new Set(STAFF.filter((st) => st.takesJobs && st.userType).map((st) => st.userType))];
  const techHint = `เฉพาะผู้มีสิทธิ์ "${RIGHTS['Job Take']}"${takerRoles.length ? ` (ตอนนี้: ${takerRoles.join(', ')})` : ''}`;
  // a job that already has someone on it goes to another person only when the user says so (the API asks too)
  const assign = async (next: Pick<JobFormState, 'engineerId' | 'engineerName'>) => {
    const had = loaded.engineerId;
    const taking = !!loaded.jobNo && had > 0 && !!next.engineerId && next.engineerId !== had;
    const ok =
      !taking ||
      s.takeOver ||
      (await confirm({
        title: `งานนี้มีผู้รับงานแล้ว (${loaded.engineerName || `#${had}`}) — มอบให้คนใหม่แทน?`,
        confirmLabel: 'มอบให้คนใหม่',
      }));
    if (ok) patch({ ...next, takeOver: taking });
  };
  return (
    <Section title="ข้อมูลอื่นๆ" icon={ClipboardList}>
      <FieldGrid>
        <Field label="ค่าประเมินงานซ่อม (บาท)" error={errors.estimateCost}>
          <Input
            type="number"
            step="0.01"
            min={0}
            inputMode="decimal"
            placeholder="0.00"
            value={s.estimateCost}
            disabled={!!lock}
            onChange={(e) => set('estimateCost', e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            className="num text-right"
          />
        </Field>
        <Field label="ค่ามัดจำงานซ่อม (บาท)" error={errors.depositCost} hint={lock}>
          <Input
            type="number"
            step="0.01"
            min={0}
            inputMode="decimal"
            placeholder="0.00"
            value={s.depositCost}
            disabled={!!lock}
            onChange={(e) => set('depositCost', e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            className="num text-right"
          />
        </Field>
        {showTech && (
          <Field label="มอบหมายงานนี้ให้" hint={techHint} error={errors.engineerId} lookup={staffLookup}>
            <SearchSelect
              value={s.engineerId ? String(s.engineerId) : ''}
              onChange={(v) => {
                const id = Number(v) || 0;
                void assign({
                  engineerId: id,
                  engineerName: staffOptions.find((o) => o.value === v)?.label ?? '',
                });
              }}
              options={staffOptions}
              placeholder="- - ยังไม่ระบุ - -"
              emptyLabel="- - ยังไม่ระบุ - -"
              searchPlaceholder="พิมพ์ชื่อช่าง…"
            />
          </Field>
        )}
        <Field
          label="วันประเมินซ่อมเสร็จ"
          required
          error={errors.dueDate}
          hint={s.dueDateAuto ? 'ตาม SLA ของประเภทงาน (ยังไม่มีผู้กำหนด) — เลือกวันเองได้' : undefined}
        >
          <Input type="date" value={s.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
      </FieldGrid>
    </Section>
  );
}

export const AttachmentSection = React.forwardRef<AttachmentsHandle, AttachmentsProps>(function AttachmentSection(
  { jobNo, files },
  ref,
) {
  return (
    <Section title="เอกสารแนบ" icon={Paperclip}>
      <Attachments ref={ref} jobNo={jobNo} files={files} />
    </Section>
  );
});
export type { AttachmentsHandle };

/** FormActions `denied` on a screen the role may open but not save */
export const VIEW_ONLY = 'ไม่มีสิทธิ์แก้ไข — ดูข้อมูลได้อย่างเดียว';

export function FormActions({
  onSave,
  saveLabel = 'บันทึกข้อมูล',
  extra,
  saving = false,
  cancelHref,
  denied,
}: {
  onSave: () => void;
  saveLabel?: string;
  extra?: React.ReactNode;
  saving?: boolean;
  /** "ยกเลิก" → this list page (asks first when something is unsaved) */
  cancelHref: string;
  /** the role lacks the grant to save here: this note (always on screen in the sticky bar) replaces
   *  the save button, so a view-only user is told before typing instead of by a 403 at save */
  denied?: string;
}) {
  const leave = useLeave();
  return (
    <div
      data-sticky-actions
      className="sticky bottom-0 z-20 -mx-3 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/90 px-3 py-3 backdrop-blur-md sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6 no-print"
    >
      {extra}
      <Button variant="outline" size="md" type="button" onClick={() => void leave(cancelHref)}>
        ยกเลิก
      </Button>
      {denied ? (
        <p role="note" className="order-first mr-auto flex items-center gap-1.5 text-sm font-medium text-warning">
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          {denied}
        </p>
      ) : (
        <Button size="md" onClick={onSave} disabled={saving}>
          {saveLabel}
        </Button>
      )}
    </div>
  );
}
