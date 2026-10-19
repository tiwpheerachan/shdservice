'use client';

import * as React from 'react';
import { Plus, Calculator } from 'lucide-react';
import { Section } from './section';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useApi } from '@/data/db';
import { QUOTATION_STATUS_OPTIONS } from '@/data/options';
import type { Customer } from '@/data/types';
import { api, errMsg, qs } from '@/lib/api';
import type { JobDetail } from '@/lib/use-job';
import { quoteJobNote } from '@/lib/quote-job';
import { useFormErrors } from '@/lib/use-form-errors';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { computeTotals, parseDiscount, quotationSchema, quotedParts } from '@/lib/validation/quotation';
import { useMountTime } from '@/lib/use-client';
import { isoDateTime } from '@/lib/dates';
import {
  QuotationCustomerSection,
  QuotationDeviceSection,
  QuotationInfoSection,
  QuotationTypeSection,
} from '@/components/quotation/header-sections';
import { QuotationLineTable } from '@/components/quotation/line-items';
import { type QuotationLine as Line, lineTotals } from '@/components/quotation/line-totals';
import { QuotationStatusFields, QuotationSummary } from '@/components/quotation/totals';

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
  version?: number; // row_version — the edit page sends it back with its save
};

/** What the page posts to /api/quotations. */
export type QuotationPayload = {
  no?: string;
  documentProfileId?: number;
  type: string;
  customerCode: string;
  contactName: string;
  jobNo: string;
  lines: {
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
};

export type QuotationFormHandle = {
  payload: () => QuotationPayload;
  customer: () => Customer | null;
  /** check before saving (lib/validation/quotation) — shows the errors; true = OK */
  validate: () => boolean;
  /** API field errors → under the fields; false for any other error */
  fromApi: (err: unknown) => boolean;
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
    /** job to prefill from (?job= on the new page) */
    jobNo?: string;
  }
>(function QuotationForm({ mode, quotationNo, initial, jobNo }, ref) {
  const { push } = useToast();
  const fe = useFormErrors();
  // an existing quotation fills the form when it mounts — the edit page remounts the form (key) for
  // every quotation it loads or saves, so this is the one place the form takes `initial`
  const [type, setType] = React.useState<'A' | 'B'>(() =>
    initial && (initial.type.startsWith('Type B') || initial.type === 'VIP') ? 'B' : 'A',
  );
  const [profileId, setProfileId] = React.useState(initial?.documentProfileId ?? 0); // ออกเอกสารในนาม — from the job when raised from one
  const [lines, setLines] = React.useState<Line[]>(() =>
    (initial?.lines ?? []).map((l, i) => ({
      id: i + 2,
      code: l.code,
      name: l.detail,
      qty: l.qty,
      price: l.unitPrice,
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
  const [contact, setContact] = React.useState(initial?.contactName ?? '');
  const [jobRef, setJobRef] = React.useState(initial?.jobRef ?? '');
  const [job, setJob] = React.useState<JobDetail | null>(initial?.job ?? null);
  const date = initial?.date ?? '';
  const idRef = React.useRef((initial?.lines.length ?? 0) + 1);

  // the form as it opened (a loaded quotation, or empty / filled from ?job=) — anything else is an
  // unsaved edit; the edit page remounts the form for every quotation it loads or saves
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
    contact,
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
  // always replaced — switching A → B with nothing quoted in B used to keep A's lines on a B quotation
  const fillQuoted = (j: JobDetail, t: 'A' | 'B') =>
    setLines(quotedParts(j.parts, t).map((p) => ({ ...p, id: ++idRef.current, itemType: 'SparePart' as const })));
  // a job → customer + device info (+ its quoted parts become lines)
  const applyJob = React.useCallback(
    async (j: JobDetail, withParts: boolean) => {
      setJob(j);
      if (mode === 'new') setProfileId(j.documentProfileId || 0);
      setJobRef(j.no);
      if (withParts) {
        fillQuoted(j, type);
        if (j.serviceCost) setService(j.serviceCost);
      }
      if (j.customer) {
        const c = await api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: j.customer.code })}`);
        setCustomer(c.rows[0] ?? null);
      }
    },
    [mode, type],
  );

  // the job number typed in the form (Enter / leaving the box)
  const loadJob = async (no: string, withParts: boolean) => {
    const v = no.trim().toUpperCase();
    if (!v) return;
    try {
      const d = await api<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(v)}`);
      await applyJob(d.job, withParts);
    } catch (e) {
      push({ kind: 'error', title: 'ไม่พบหมายเลขงาน', desc: errMsg(e) });
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
        .catch((e) => push({ kind: 'error', title: 'โหลดข้อมูลลูกค้าไม่สำเร็จ', desc: errMsg(e) }))
        .finally(() => setSettled(false));
    },
    onError: (msg) => push({ kind: 'error', title: 'ไม่พบหมายเลขงาน', desc: msg }),
  });

  const add = () =>
    setLines((s) => [...s, { id: ++idRef.current + 100, code: '', name: '', qty: 1, price: 0, itemType: 'SparePart' }]);

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
    contactName: contact,
    jobNo: jobRef,
    // every row, in screen order (line errors point at the row); the API drops empty rows
    lines: lines.map((l) => ({
      code: l.code,
      detail: l.name,
      qty: l.qty,
      unitPrice: l.price,
      itemType: l.itemType,
      unit: 'หน่วย',
      discount: 0,
      discountPercent: 0,
    })),
    serviceAmount: service,
    discountType: discount > 0 ? discountType : 'ไม่มีส่วนลด',
    discountValue: discount,
    discountUnit,
    vatRate,
    remark,
    status,
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
      />

      <QuotationCustomerSection
        customer={customer}
        setCustomer={setCustomer}
        contact={contact}
        setContact={setContact}
        errors={fe.errors}
      />

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
        />

        <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
          <QuotationStatusFields
            remark={remark}
            setRemark={setRemark}
            status={status}
            onStatus={(v) => {
              setStatus(v);
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
          />
        </div>
      </Section>
    </>
  );
});
