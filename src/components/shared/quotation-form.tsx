'use client';

import * as React from 'react';
import { Plus, Calculator } from 'lucide-react';
import { Section } from './section';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { QUOTATION_STATUS_OPTIONS } from '@/data/options';
import type { Customer } from '@/data/types';
import { api, errMsg, qs } from '@/lib/api';
import { jobIdOf, type JobDetail } from '@/lib/use-job';
import { quoteJobNote } from '@/lib/quote-job';
import { useFormErrors } from '@/lib/use-form-errors';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { computeTotals, parseDiscount, quotationSchema, quotedParts, quotedPartsKey } from '@/lib/validation/quotation';
import { QS } from '@/lib/status-ids';
import { useMountTime } from '@/lib/use-client';
import { isoDateTime } from '@/lib/dates';
import {
  QuotationCustomerSection,
  QuotationDeviceSection,
  QuotationInfoSection,
  QuotationTypeSection,
} from '@/components/quotation/header-sections';
import { QuotationLineTable } from '@/components/quotation/line-items';
import { type QuotationLine as Line, lineOf, lineTotals } from '@/components/quotation/line-totals';
import { QuotationStatusFields, QuotationSummary } from '@/components/quotation/totals';
import { useTourRestore } from '@/components/tour/tour';
import { profileLock } from '@/lib/profile-lock';
import { useAccess } from '@/lib/use-access';
import { FIGURES_LOCKED } from '@/lib/validation';

/** Shape returned by GET /api/quotations/:id (subset the form uses). */
export type QuotationLoaded = {
  /** the quotation's uuid — its links (edit page, print) */
  id: string;
  no: string;
  date: string;
  type: string;
  status: string;
  statusId?: number;
  /** false = deleted (ยกเลิกใบเสนอราคา from the list) — no save, no print */
  active?: boolean;
  customerCode?: string;
  jobRef: string;
  remark: string;
  serviceAmount?: number;
  discountType: string;
  discountFormula: string;
  vatRate: number;
  lines: {
    /** the line's uuid */
    id?: string;
    itemType: string;
    code: string;
    detail: string;
    qty: number;
    unitPrice: number;
    discount?: number;
    discountPercent?: number;
  }[];
  customerDetail: Customer | null;
  job: JobDetail | null;
  approveDate?: string; // quotation_hd.customer_approve_date
  createdBy?: string;
  documentProfileId?: string; // ออกเอกสารในนาม (a profile's uuid)
  version?: number; // row_version — the edit page sends it back with its save
  /** from the legacy system: its figures are System Admin's alone (the server refuses anyone else's change) */
  figuresLocked?: boolean;
};

/** What the page posts to /api/quotations. */
export type QuotationPayload = {
  no?: string;
  documentProfileId?: string;
  type: string;
  customerCode: string;
  jobNo: string;
  lines: {
    /** a stored line's uuid; none = a new line */
    id?: string;
    code: string;
    detail: string;
    qty: number;
    unitPrice: number;
    itemType: string;
    unit: string;
    discount: number;
    discountPercent: number;
  }[];
  serviceAmount: number;
  discountType: string;
  discountValue: number;
  discountUnit: 'บาท' | '%';
  vatRate: number;
  remark: string;
  status: string;
  /** a new quotation filled from its job: the job's quoted parts it copied (the server refuses a stale copy) */
  jobParts?: string;
};

/** a quotation the customer can still answer, or has agreed to */
const OPEN_QUOTE = new Set<number>([QS.WAIT, QS.SENT, QS.AGREED, QS.AGREED_WAIT_PAY, QS.AGREED_WAIT_PARTS]);

export type QuotationFormHandle = {
  payload: () => QuotationPayload;
  customer: () => Customer | null;
  /** check before saving (lib/validation/quotation) — shows the errors; true = OK */
  validate: () => boolean;
  /** API field errors → under the fields; false for any other error */
  fromApi: (err: unknown, reload?: () => void) => boolean;
};

// quotation_status names (DB) → badge tone (list + report)
export const QUOTATION_TONE: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  รอเสนอราคา: 'warning',
  เสนอราคาแล้ว: 'info',
  ลูกค้าตกลงซ่อม: 'success',
  'ลูกค้าตกลงซ่อม รอชำระเงิน': 'success',
  'ลูกค้าตกลงซ่อม รออะไหล่': 'success',
  ลูกค้าไม่ตกลงซ่อม: 'danger',
  พ้นกำหนดเสนอราคา: 'danger',
  ยกเลิกใบเสนอราคา: 'neutral',
};

export const QuotationForm = React.forwardRef<
  QuotationFormHandle,
  {
    mode: 'new' | 'edit';
    quotationNo?: string;
    initial?: QuotationLoaded | null;
    /** the job (its uuid) to prefill from (?job= on the new page) */
    jobId?: string;
  }
>(function QuotationForm({ mode, quotationNo, initial, jobId }, ref) {
  const { push } = useToast();
  const fe = useFormErrors();
  const { isAdmin } = useAccess();
  // a legacy quotation's recorded figures are System Admin's alone (legacy-lock.ts): its loaded lines (ids 2…n+1,
  // below every added one) and a service / discount / VAT it holds — new lines and the rest stay editable
  const figuresLocked = !!initial?.figuresLocked && !isAdmin;
  const loadedLines = initial?.lines.length ?? 0;
  const lineLocked = (l: Line) => figuresLocked && l.id <= loadedLines + 1;
  // an existing quotation fills the form when it mounts — the edit page remounts the form (key) for
  // every quotation it loads or saves, so this is the one place the form takes `initial`
  const [type, setType] = React.useState<'A' | 'B'>(() =>
    initial && (initial.type.startsWith('Type B') || initial.type === 'VIP') ? 'B' : 'A',
  );
  const [profileId, setProfileId] = React.useState(initial?.documentProfileId ?? ''); // ออกเอกสารในนาม — from the job when raised from one
  const [lines, setLines] = React.useState<Line[]>(() =>
    (initial?.lines ?? []).map((l, i) => ({
      id: i + 2,
      uid: l.id,
      code: l.code,
      name: l.detail,
      qty: l.qty,
      price: l.unitPrice,
      discount: l.discount ?? 0,
      discountPercent: l.discountPercent ?? 0,
      itemType: (l.itemType as Line['itemType']) || 'SparePart',
    })),
  );
  const [service, setService] = React.useState(initial?.serviceAmount ?? 0);
  // a loaded quotation keeps its own discount: % or บาท (legacy "200บาท"), on the total / parts / service
  const loadedDiscount = parseDiscount(initial?.discountType ?? 'ไม่มีส่วนลด', initial?.discountFormula ?? '');
  const discountType = loadedDiscount.type;
  const [discount, setDiscount] = React.useState(loadedDiscount.value);
  const [discountUnit, setDiscountUnit] = React.useState(loadedDiscount.unit);
  const [vatRate, setVatRate] = React.useState(initial?.vatRate ?? 0);
  const [remark, setRemark] = React.useState(initial?.remark ?? '');
  const [status, setStatus] = React.useState(initial?.status || QUOTATION_STATUS_OPTIONS[0]);
  const [customer, setCustomer] = React.useState<Customer | null>(initial?.customerDetail ?? null);
  const [jobRef, setJobRef] = React.useState(initial?.jobRef ?? '');
  const [job, setJob] = React.useState<JobDetail | null>(initial?.job ?? null);
  const date = initial?.date ?? '';
  const idRef = React.useRef((initial?.lines.length ?? 0) + 1);
  // the job's quoted parts the lines were filled from (sent with a new quotation's save)
  const [jobParts, setJobParts] = React.useState<string>();
  // a บทสอน that tried the form (typed, picked a job, added rows) leaves it as it found it
  useTourRestore(
    () => ({
      type,
      profileId,
      lines,
      service,
      discount,
      discountUnit,
      vatRate,
      remark,
      status,
      customer,
      jobRef,
      job,
      jobParts,
    }),
    (v) => {
      setType(v.type);
      setProfileId(v.profileId);
      setLines(v.lines);
      setService(v.service);
      setDiscount(v.discount);
      setDiscountUnit(v.discountUnit);
      setVatRate(v.vatRate);
      setRemark(v.remark);
      setStatus(v.status);
      setCustomer(v.customer);
      setJobRef(v.jobRef);
      setJob(v.job);
      setJobParts(v.jobParts);
      fe.setErrors({});
    },
  );

  // the form as it opened (a loaded quotation, or empty / filled from ?job=) — anything else is an
  // unsaved edit
  const now = {
    type,
    profileId,
    lines,
    service,
    discount,
    discountUnit,
    vatRate,
    remark,
    status,
    customer: customer?.code ?? '',
    jobRef,
  };
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

  // the job's parts flagged "เสนอ" in the repair screen, from set A or set B (= the quotation type)
  // always replaced — otherwise switching A → B with nothing quoted in B would keep A's lines on a B quotation
  const fillQuoted = (j: JobDetail, t: 'A' | 'B') => {
    setLines(
      quotedParts(j.parts, t).map((p) => ({
        ...p,
        id: ++idRef.current,
        discount: 0,
        discountPercent: 0,
        itemType: 'SparePart' as const,
      })),
    );
    setJobParts(quotedPartsKey(j.parts, t));
  };
  // a job → customer + device info (+ its quoted parts become lines)
  const applyJob = React.useCallback(
    async (j: JobDetail, withParts: boolean) => {
      setJob(j);
      if (mode === 'new') setProfileId(j.documentProfileId || '');
      setJobRef(j.no);
      if (withParts) {
        fillQuoted(j, type);
        if (j.serviceCost) setService(j.serviceCost);
      } else setJobParts(undefined); // the lines are not this job's copy
      // a hint, not a stop: the job already has quotations still open (a second one may be an alternative)
      if (mode === 'new')
        api<{ rows: { no: string; status: string; statusId: number }[] }>(
          `/api/data/quotations${qs({ paged: 1, pageSize: 20, jobNo: j.no })}`,
        )
          .then((d) => {
            const open = d.rows.filter((q) => OPEN_QUOTE.has(q.statusId) && q.status !== 'พ้นกำหนดเสนอราคา');
            if (open.length)
              push({
                kind: 'warning',
                title: `งาน ${j.no} มีใบเสนอราคาที่ยังเปิดอยู่ ${open.length} ใบ`,
                desc: open.map((q) => `${q.no} (${q.status})`).join(', '),
              });
          })
          .catch(() => {}); // only a hint
      if (j.customer) {
        const { code } = j.customer;
        const c = await api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: code })}`);
        setCustomer(c.rows.find((r) => r.code === code) ?? null);
      }
    },
    [mode, type, push],
  );

  // the job number typed in the form (Enter / leaving the box)
  const loadJob = async (no: string, withParts: boolean) => {
    const v = no.trim().toUpperCase();
    if (!v) return;
    try {
      const id = await jobIdOf(v); // the number typed → the job's uuid (its API path)
      if (!id) return push({ kind: 'error', title: 'ไม่พบหมายเลขงาน', desc: v });
      const d = await api<{ job: JobDetail }>(`/api/jobs/${id}`);
      await applyJob(d.job, withParts);
    } catch (e) {
      push({ kind: 'error', title: 'ไม่พบหมายเลขงาน', desc: errMsg(e) });
    }
  };

  // /quotation/new?job=<the job's uuid> opens with that job, its customer and its quoted parts filled in — once.
  // A direct read, NOT the swr cache: the job screens keep the bare JobDetail under /api/jobs/<id>
  // (useRecord, and the server prefetch seeds it), this answer is { job } — sharing the key handed
  // each screen the other's shape.
  const urlJobApplied = React.useRef(false);
  React.useEffect(() => {
    const id = jobId?.trim();
    if (!id || initial || urlJobApplied.current) return;
    urlJobApplied.current = true;
    api<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(id)}`).then(
      (d) =>
        applyJob(d.job, true)
          .catch((e) => push({ kind: 'error', title: 'โหลดข้อมูลลูกค้าไม่สำเร็จ', desc: errMsg(e) }))
          .finally(() => setSettled(false)),
      (e) => push({ kind: 'error', title: 'ไม่พบหมายเลขงาน', desc: errMsg(e) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page: the URL's job, not every render of applyJob
  }, [jobId, initial]);

  const add = () =>
    setLines((s) => [
      ...s,
      {
        id: ++idRef.current + 100,
        code: '',
        name: '',
        qty: 1,
        price: 0,
        discount: 0,
        discountPercent: 0,
        itemType: 'SparePart',
      },
    ]);

  const { parts: partsTotal, delivery: deliveryTotal } = lineTotals(lines);
  // the server's own rules (stored amounts = what the print shows)
  const t = computeTotals({
    parts: partsTotal,
    service,
    delivery: deliveryTotal,
    discountType: discount > 0 ? discountType : 'ไม่มีส่วนลด',
    discountValue: discount,
    discountUnit,
    vatRate,
  });

  // a value that changes — typed or filled in from the job — takes its error away
  const { clear } = fe;
  React.useEffect(() => clear('customerCode'), [customer, clear]);
  React.useEffect(() => clear('jobNo'), [jobRef, clear]);

  // the save moves the job only when the status changes (followQuotation) — the stored status says nothing new
  const jobNoteOf = (st: string) => (st === initial?.status ? '' : quoteJobNote(st, job));

  const payload = (): QuotationPayload => ({
    no: quotationNo || initial?.no || undefined,
    documentProfileId: profileId || undefined,
    type: type === 'A' ? 'Type A (Normal)' : 'Type B (VIP)',
    customerCode: customer?.code ?? '',
    jobNo: jobRef,
    // every row, in screen order (line errors point at the row); the API drops empty rows
    lines: lines.map((l) => ({
      id: l.uid,
      code: l.code,
      detail: l.name,
      qty: l.qty,
      unitPrice: l.price,
      itemType: l.itemType,
      unit: 'หน่วย',
      discount: lineOf(l).discount, // a % sends the บาท it makes (the server recomputes it the same way)
      discountPercent: l.discountPercent,
    })),
    serviceAmount: service,
    discountType: discount > 0 ? discountType : 'ไม่มีส่วนลด',
    discountValue: discount,
    discountUnit,
    vatRate,
    remark,
    status,
    jobParts: mode === 'new' ? jobParts : undefined,
  });
  React.useImperativeHandle(ref, () => ({
    customer: () => customer,
    payload,
    // an old quotation saved without a job may stay without one ("never worse")
    validate: () =>
      !fe.report(fe.run(quotationSchema(mode === 'new' ? undefined : (initial?.jobRef ?? '')), payload())),
    fromApi: fe.fromApi,
  }));

  return (
    <>
      <QuotationTypeSection
        type={type}
        onType={(t) => {
          setType(t);
          // a new quotation from a job: switching A ↔ B quotes that set's parts instead
          if (mode === 'new' && job && t !== type) fillQuoted(job, t);
        }}
        profileId={profileId}
        onProfile={(id, how) => {
          setProfileId(id);
          if (how !== 'user') setSaved((x) => ({ ...x, profileId: id })); // a default / saved on the spot — not an edit
        }}
        docNo={initial?.no || quotationNo}
        profileLocked={profileLock('quotation', { statusId: initial?.statusId })} // the saved status, not the one being edited
      />

      <QuotationCustomerSection customer={customer} setCustomer={setCustomer} errors={fe.errors} />

      <QuotationInfoSection
        no={quotationNo ?? initial?.no ?? (mode === 'new' ? 'Generate Auto' : '—')}
        date={date || (openedAt ? isoDateTime(openedAt) : '')}
        jobRef={jobRef}
        setJobRef={setJobRef}
        jobRequired={mode === 'new' || !!initial?.jobRef?.trim()}
        jobError={fe.errors.jobNo}
        onLoadJob={() => loadJob(jobRef, lines.length === 0)}
        job={job}
        linkJob={mode === 'edit'}
      />

      <QuotationDeviceSection job={job} />

      <Section
        title="รายการอะไหล่และบริการ"
        icon={Calculator}
        description={figuresLocked ? FIGURES_LOCKED : undefined}
        actions={
          <Button size="sm" variant="outline" onClick={add}>
            <Plus className="h-3.5 w-3.5" />
            เพิ่มรายการ
          </Button>
        }
        bodyClassName="p-0"
      >
        <QuotationLineTable
          lines={lines}
          setLines={setLines}
          errors={fe.errors}
          clear={fe.clear}
          showZero={!!initial}
          locked={lineLocked}
        />

        <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
          <QuotationStatusFields
            remark={remark}
            setRemark={setRemark}
            status={status}
            onStatus={(v) => {
              setStatus(v);
              fe.clear('status');
              const note = jobNoteOf(v);
              if (note) push({ kind: 'info', title: 'บันทึกได้ แต่สถานะงานจะไม่เปลี่ยน', desc: note });
            }}
            jobNote={jobNoteOf(status)}
            loaded={initial}
            errors={fe.errors}
          />

          <QuotationSummary
            partsTotal={partsTotal}
            deliveryTotal={deliveryTotal}
            t={t}
            service={service}
            setService={setService}
            discountType={discountType}
            discount={discount}
            setDiscount={setDiscount}
            discountUnit={discountUnit}
            setDiscountUnit={setDiscountUnit}
            vatRate={vatRate}
            setVatRate={setVatRate}
            errors={fe.errors}
            clear={fe.clear}
            showZero={!!initial}
            locked={{
              service: figuresLocked && !!initial?.serviceAmount,
              discount: figuresLocked && loadedDiscount.value > 0,
              vat: figuresLocked && !!initial?.vatRate,
            }}
          />
        </div>
      </Section>
    </>
  );
});
