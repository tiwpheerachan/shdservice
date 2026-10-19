'use client';

import * as React from 'react';
import { Search, UserRound, ClipboardList, PackageSearch, Coins, Paperclip, TriangleAlert, Lock } from 'lucide-react';
import { Section } from './section';
import { SymptomPicker } from './symptom-picker';
import { ModelPicker } from './model-picker';
import { SearchSelect, strOptions, withCurrent } from './search-select';
import { CustomerSelect } from './customer-select';
import { ProfileSelect } from './profile-select';
import { Attachments, type AttachmentsHandle } from './attachments';
import { Button } from '@/components/ui/button';
import { Field, FieldGrid, LookupError, ReadOnly } from '@/components/ui/field';
import { Input, Select, Textarea, Radio, Checkbox } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm';
import { CHANNELS, RECEIVE_METHODS, WARRANTY_OPTIONS, type Customer } from '@/data/mock';
import {
  useJobTypes,
  useJobTypeDetails,
  useSymptomStats,
  useModelSymptoms,
  useManufacturers,
  useModels,
  useProductTypes,
  useSymptoms,
  useStaff,
  useShopNames,
  useShippingProfiles,
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
  isRequiredFor,
  jobBalance,
  JOB_FIELD_LABEL,
  MONEY_LOCKED,
  NO_SERIAL,
  type JobCheck,
  type JobRequiredKey,
} from '@/lib/validation/job';
import type { FieldErrors } from '@/lib/validation';
import { useMountTime } from '@/lib/use-client';
import { isoDateTime, today } from '@/lib/dates';
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

/** a job screen's page: the form state + the Suspense useJob's useSearchParams needs */
export function JobScreen({ children }: { children: React.ReactNode }) {
  return (
    <JobFormProvider>
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
  const { data: JOB_TYPES } = useJobTypes();
  const { data: JOB_TYPE_DETAILS } = useJobTypeDetails();
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
        <Field label="ประเภทงานหลัก" required error={errors.jobType} className="lg:col-span-2">
          <SearchSelect
            value={s.jobType}
            onChange={(v) => set('jobType', v)}
            options={withCurrent(
              JOB_TYPES.map((j) => ({ value: j.name, label: j.name })),
              s.jobType,
            )}
          />
        </Field>
        <Field label="งานย่อย" className="lg:col-span-2" error={errors.jobTypeDetail}>
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

/** อาการเสียหลัก (มาตรฐาน) — searchable multi-select bound to the form's symptoms (first = main);
 *  ordered by real usage, with the chosen model's common symptoms on top. Used by ProductSection
 *  and the Out-Source "รายละเอียดการซ่อม" tab. */
export function MainSymptomField() {
  const { s, set, errors } = useJobForm();
  const { data: MODELS } = useModels();
  const { data: SYMPTOMS, error: symptomsError, refetch: retrySymptoms } = useSymptoms();
  const { data: SYMPTOM_STATS, error: statsError, refetch: retryStats } = useSymptomStats();
  const { data: MODEL_SYMPTOMS } = useModelSymptoms(s.modelCode);
  const symptoms = s.symptoms;
  // the picker reads the stats, else the plain list — empty only when both failed
  const listError = SYMPTOM_STATS.length || SYMPTOMS.length ? null : (statsError ?? symptomsError);
  return (
    <Field
      label="อาการเสียหลัก (มาตรฐาน)"
      required
      wide
      error={errors.symptoms}
      hint={
        symptoms.length
          ? `เลือกแล้ว ${symptoms.length} อาการ · ★ ${symptoms[0]} = อาการหลัก`
          : 'ค้นหาแล้วติ๊กได้หลายอาการ · ตัวแรกที่เลือกเป็นอาการหลัก'
      }
    >
      <SymptomPicker
        value={symptoms}
        onChange={(names) => set('symptoms', names)}
        options={SYMPTOM_STATS.length ? SYMPTOM_STATS : SYMPTOMS.map((sy) => ({ id: Number(sy.id), name: sy.name }))}
        suggested={MODEL_SYMPTOMS}
        suggestedLabel={
          s.modelCode
            ? `อาการที่พบบ่อยของรุ่น ${MODELS.find((m) => m.code === s.modelCode)?.name ?? s.modelCode}`
            : 'อาการที่พบบ่อย'
        }
      />
      <LookupError
        error={listError}
        onRetry={() => {
          retryStats();
          retrySymptoms();
        }}
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
  const { s, set, patch, errors, incomplete } = useJobForm();
  const { data: PRODUCT_TYPES, error: typesError, refetch: retryTypes } = useProductTypes();
  const { data: MANUFACTURERS, error: brandsError, refetch: retryBrands } = useManufacturers();
  const { data: MODELS, error: modelsError, refetch: retryModels } = useModels();

  // models of the chosen brand first (still allows any model)
  const modelOptions = React.useMemo(() => {
    const own = MODELS.filter((m) => !s.brand || m.brand === s.brand);
    return own.length ? own : MODELS;
  }, [MODELS, s.brand]);

  // Warranty the user has not picked follows the expire date: today or later = IN, passed = OUT
  const withExpire = (expireDate: string): Partial<JobFormState> =>
    /^\d{4}-\d{2}-\d{2}$/.test(expireDate) && (!s.warranty || s.warrantyAuto)
      ? { expireDate, warranty: expireDate >= today() ? 'IN' : 'OUT', warrantyAuto: true }
      : { expireDate };
  // expire date = sale order date + warranty months
  const recalcExpire = (saleDate: string, months: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return;
    const m = Number(months) || 0;
    const d = new Date(saleDate + 'T00:00:00');
    d.setMonth(d.getMonth() + m);
    const p = (n: number) => String(n).padStart(2, '0');
    patch(withExpire(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`));
  };
  // walk-in (หน้าร้าน): no sale order — SO no. / SO date / expire date may stay empty
  const needed = (k: JobRequiredKey) => isRequiredFor(k, s.channel);

  const repair = variant === 'repair';
  const noSerial = s.serial.trim() === NO_SERIAL;
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
  const open = variant === 'open';
  const { data: SHOP_NAMES } = useShopNames();
  const { data: SHIPPING_PROFILES } = useShippingProfiles();

  const soField = (
    <Field label="Sale Order No." required={needed('so')} error={errors.so}>
      <Input
        placeholder="SO2600760"
        className="num"
        maxLength={50}
        value={s.so}
        onChange={(e) => set('so', e.target.value)}
      />
    </Field>
  );
  const channelField = (
    <Field label={repair ? 'Sale Channel' : 'Channel'} required error={errors.channel}>
      <SearchSelect
        value={s.channel}
        onChange={(v) => set('channel', v)}
        // "ยังไม่ระบุ" is the legacy "none" (counts as empty) — a legacy job still shows its own value
        options={withCurrent(strOptions(CHANNELS.filter((c) => c !== 'ยังไม่ระบุ')), s.channel)}
      />
    </Field>
  );
  const saleDateField = (
    <Field label="Sale Order Date" required={needed('saleOrderDate')} error={errors.saleOrderDate}>
      <Input
        type="date"
        value={s.saleOrderDate}
        onChange={(e) => {
          set('saleOrderDate', e.target.value);
          recalcExpire(e.target.value, s.warrantyMonth);
        }}
      />
    </Field>
  );
  const warrantyMonthField = (
    <Field label="รับประกัน (เดือน)" required error={errors.warrantyMonth}>
      <Input
        type="number"
        min={0}
        max={60}
        inputMode="numeric"
        value={s.warrantyMonth}
        onChange={(e) => {
          set('warrantyMonth', e.target.value);
          recalcExpire(s.saleOrderDate, e.target.value);
        }}
        onFocus={(e) => e.currentTarget.select()}
        className="num text-right"
      />
    </Field>
  );
  const expireField = (
    <Field label="Expire Date" required={needed('expireDate')} error={errors.expireDate}>
      <Input type="date" value={s.expireDate} onChange={(e) => patch(withExpire(e.target.value))} />
    </Field>
  );
  const warrantyField = (
    <Field label="Warranty" error={errors.warranty}>
      <Select value={s.warranty} onChange={(e) => patch({ warranty: e.target.value, warrantyAuto: false })}>
        <option value="">- - Please Select - -</option>
        {WARRANTY_OPTIONS.map((w) => (
          <option key={w}>{w}</option>
        ))}
      </Select>
    </Field>
  );
  const imeiField = (
    <Field label="Imei No." error={errors.imei}>
      <Input
        className="num"
        inputMode="numeric"
        maxLength={50}
        placeholder="35xxxxxxxxxxxxx"
        value={s.imei}
        onChange={(e) => set('imei', e.target.value)}
      />
    </Field>
  );
  const serialField = (
    <Field label="Serial No." required error={errors.serial}>
      <Input
        className="num"
        maxLength={50}
        placeholder={noSerial ? 'ไม่มี S/N / S/N เสียหาย' : 'SN-XXXXXXXX'}
        value={noSerial ? '' : s.serial}
        disabled={noSerial}
        onChange={(e) => set('serial', e.target.value)}
      />
      {/* stored as the legacy "none" marker "-" (NO_SERIAL) — instead of typing a note into the serial */}
      <label className="mt-1.5 flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={noSerial} onChange={(e) => set('serial', e.target.checked ? NO_SERIAL : '')} />
        ไม่มี S/N / S/N เสียหาย
      </label>
    </Field>
  );
  const brandField = (
    <Field label="ยี่ห้อ" required error={errors.brand}>
      <SearchSelect
        value={s.brand}
        onChange={(v) => set('brand', v)}
        options={withCurrent(
          MANUFACTURERS.map((m) => ({ value: m.name, label: m.name })),
          s.brand,
        )}
        searchPlaceholder="พิมพ์ชื่อยี่ห้อ…"
      />
      <LookupError error={brandsError} onRetry={retryBrands} />
    </Field>
  );
  const modelField = (
    <Field label="รุ่น" required error={errors.modelCode}>
      <ModelPicker
        models={modelOptions}
        value={s.modelCode}
        fallbackName={MODELS.find((m) => m.code === s.modelCode)?.name}
        onPick={(m) => patch({ modelCode: m.code, brand: m.brand || s.brand })}
      />
      <LookupError error={modelsError} onRetry={retryModels} />
    </Field>
  );
  const modelDetailField = (
    <Field label="รุ่นย่อย (ถ้ามี)" error={errors.modelDetail}>
      <Input maxLength={200} value={s.modelDetail} onChange={(e) => set('modelDetail', e.target.value)} />
    </Field>
  );
  const equipmentField = (
    <Field label="อุปกรณ์ (ที่นำส่ง)" className="lg:col-span-2" error={errors.equipment}>
      <Textarea
        rows={2}
        maxLength={100}
        placeholder="เช่น อะแดปเตอร์, รีโมท, กล่อง"
        value={s.equipment}
        onChange={(e) => set('equipment', e.target.value)}
      />
    </Field>
  );
  const faultField = (
    <Field label="จุดตำหนิ" className="lg:col-span-2" error={errors.fault}>
      <Textarea
        rows={2}
        maxLength={100}
        placeholder="รอยขีดข่วน / รอยบุบ ฯลฯ"
        value={s.fault}
        onChange={(e) => set('fault', e.target.value)}
      />
    </Field>
  );
  const symptomsField = <MainSymptomField />;
  const symptomOtherField = (
    <Field label="อาการเสีย (อื่นๆ)" className="lg:col-span-2" error={errors.symptomOther}>
      <Textarea rows={2} maxLength={200} value={s.symptomOther} onChange={(e) => set('symptomOther', e.target.value)} />
    </Field>
  );
  const remarkField = (
    <Field label="หมายเหตุ" className="lg:col-span-2" error={errors.remark}>
      <Textarea rows={2} maxLength={2000} value={s.remark} onChange={(e) => set('remark', e.target.value)} />
    </Field>
  );

  const shopField = open ? (
    <Field label="Shop Name" error={errors.shopName}>
      {/* free text in the legacy data (511 spellings) — the most used names as suggestions, new ones can be typed */}
      <Input
        list="shop-name-options"
        maxLength={100}
        placeholder="- - เลือกหรือพิมพ์ - -"
        value={s.shopName}
        onChange={(e) => set('shopName', e.target.value)}
      />
      <datalist id="shop-name-options">
        {SHOP_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </Field>
  ) : (
    <Field label="Shop Name" error={errors.shopName}>
      <Input
        placeholder="ชื่อร้านค้า"
        maxLength={100}
        value={s.shopName}
        onChange={(e) => set('shopName', e.target.value)}
      />
    </Field>
  );
  const receptionDateField = (
    <Field label="วันที่รับเข้า" error={errors.receptionDate}>
      <Input type="date" value={s.receptionDate} onChange={(e) => set('receptionDate', e.target.value)} />
    </Field>
  );
  const trackingField = (
    <Field
      label="เลขพัสดุจากลูกค้า"
      error={errors.receptionTrackingNo}
      hint="ไม่มีเลขพัสดุ (ลูกค้า / ไรเดอร์มาส่งเอง) ให้เว้นว่าง แล้วเลือก รับสินค้าเข้าโดย"
    >
      <Input
        className="num"
        maxLength={50}
        value={s.receptionTrackingNo}
        onChange={(e) => set('receptionTrackingNo', e.target.value)}
      />
    </Field>
  );
  // courier names from โปรไฟล์บริษัทขนส่ง; a legacy free-text value ("F", "flash" …) stays selectable as-is
  const legacyShipper =
    s.receptionShipper && !SHIPPING_PROFILES.some((p) => p.nameTh === s.receptionShipper) ? s.receptionShipper : '';
  // the API accepts a profile name or the job's own legacy value only (no free text)
  const shipperField = (
    <Field label="โดยบริษัทขนส่ง" error={errors.receptionShipper}>
      <Select value={s.receptionShipper} onChange={(e) => set('receptionShipper', e.target.value)}>
        <option value="">- - Please Select - -</option>
        {SHIPPING_PROFILES.map((p) => (
          <option key={p.id} value={p.nameTh}>
            {p.nameTh}
          </option>
        ))}
        {legacyShipper && <option value={legacyShipper}>{legacyShipper} (ค่าเดิม)</option>}
      </Select>
    </Field>
  );
  const receptionTypeField = (
    <Field label="รับสินค้าเข้าโดย" wide group="radiogroup" error={errors.receptionType}>
      <div className="flex flex-wrap gap-4 rounded-md border border-border bg-muted/40 px-3 py-2">
        {RECEIVE_METHODS.map((m) => (
          <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
            <Radio name="receive-method" checked={s.receptionType === m} onChange={() => set('receptionType', m)} />
            {m}
          </label>
        ))}
      </div>
    </Field>
  );

  if (open)
    return (
      <Section title={title} icon={PackageSearch}>
        {incompleteNotice}
        <FieldGrid>
          {soField}
          {channelField}
          {shopField}
          {saleDateField}

          {warrantyMonthField}
          {imeiField}
          {serialField}
          {expireField}

          {warrantyField}
          {brandField}
          {modelField}
          {modelDetailField}

          {receptionTypeField}
          {receptionDateField}
          {trackingField}
          {shipperField}
          <div className="hidden lg:block" aria-hidden />

          {equipmentField}
          {faultField}
          {symptomsField}
          {symptomOtherField}
          {remarkField}
        </FieldGrid>
      </Section>
    );

  if (repair)
    return (
      <Section title={title} icon={PackageSearch}>
        {incompleteNotice}
        <FieldGrid>
          {soField}
          {channelField}
          {saleDateField}
          {warrantyMonthField}

          {imeiField}
          {serialField}
          {expireField}
          {warrantyField}

          {brandField}
          {modelField}
          {modelDetailField}
          <div className="hidden lg:block" aria-hidden />

          {equipmentField}
          {faultField}
          {symptomsField}
          {symptomOtherField}
          {remarkField}
        </FieldGrid>
      </Section>
    );

  return (
    <Section title={title} icon={PackageSearch}>
      {incompleteNotice}
      <FieldGrid>
        {soField}
        {channelField}
        {shopField}
        {saleDateField}

        {warrantyMonthField}
        {expireField}
        {warrantyField}
        <Field label="ประเภทสินค้า" error={errors.productType}>
          <SearchSelect
            value={s.productType}
            onChange={(v) => set('productType', v)}
            options={withCurrent(
              PRODUCT_TYPES.map((p) => ({ value: p.name, label: p.name })),
              s.productType,
            )}
          />
          <LookupError error={typesError} onRetry={retryTypes} />
        </Field>

        {imeiField}
        {serialField}
        {brandField}
        {modelField}

        {modelDetailField}
        {receptionDateField}
        {trackingField}
        {shipperField}

        {receptionTypeField}

        {equipmentField}
        {faultField}

        {symptomsField}

        {symptomOtherField}
        {remarkField}
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
                  className="num h-9 w-full rounded-md border border-input bg-card px-3 text-right text-sm outline-hidden transition-colors placeholder:text-muted-foreground/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:bg-muted/60"
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
  const { data: STAFF } = useStaff();
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
          <Field label="มอบหมายงานนี้ให้" hint={techHint} error={errors.engineerId}>
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

export const AttachmentSection = React.forwardRef<AttachmentsHandle, { jobNo?: string }>(function AttachmentSection(
  { jobNo },
  ref,
) {
  return (
    <Section title="เอกสารแนบ" icon={Paperclip}>
      <Attachments ref={ref} jobNo={jobNo} />
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
