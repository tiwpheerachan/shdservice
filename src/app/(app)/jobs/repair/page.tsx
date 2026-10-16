'use client';

import * as React from 'react';
import { Plus, Trash2, Wrench, Stethoscope } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { JobSearch } from '@/components/shared/job-search';
import { JobHistorySection } from '@/components/shared/job-history';
import { Section } from '@/components/shared/section';
import {
  CustomerSection,
  ProductSection,
  CostSummary,
  OtherInfoSection,
  AttachmentSection,
  FormActions,
  VIEW_ONLY,
  JobFormProvider,
  useJobForm,
  fromJob,
  saveCommonSections,
  useWorkflowErrors,
  useMoneyLock,
} from '@/components/shared/job-form';
import { useAccess } from '@/lib/use-access';
import { Badge, type Tone } from '@/components/ui/badge';
import { Field, FieldGrid, ReadOnly } from '@/components/ui/field';
import { Input, Textarea, Checkbox, NumberInput } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { REPAIR_STATUS_OPTIONS } from '@/data/mock';
import { ProductPicker } from '@/components/shared/product-picker';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { SymptomPicker } from '@/components/shared/symptom-picker';
import { useProducts, useSymptoms, useSymptomStats, useModelSymptoms } from '@/data/db';
import { baht } from '@/lib/utils';
import { RecordGate } from '@/components/shared/record-gate';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useJob, type JobDetail } from '@/lib/use-job';
import { PrintButton } from '@/components/shared/print-button';
import { postJson, errMsg } from '@/lib/api';
import {
  partCharge,
  partsNotIssuedMsg,
  partsWaitingMsg,
  repairActionSchema,
  REOPEN_LOCKED,
} from '@/lib/validation/job';

/** ซ่อมเสร็จ / ซ่อมเสร็จ (ชำระเงินแล้ว) — refused while a part requested from stock is not issued (setStatus) */
const REPAIRED = ['ซ่อมเสร็จ', 'ซ่อมเสร็จ (ชำระเงินแล้ว)'];
/** ลูกค้าไม่ซ่อม / ไม่พบอาการเสีย — refused the same way, the part line has to be cancelled first (setStatus) */
const NO_REPAIR = ['ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)', 'ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน)'];
/** a line not ticked เบิก: priced in the quotation only, stock is not asked for it */
const QUOTE_ONLY = 'เสนอ (ยังไม่เบิก)';

type Line = {
  id: number;
  logId?: number; // existing job_order_spare_part_log row
  code: string;
  name: string;
  price: number;
  aPick: boolean;
  aQuote: boolean;
  aQty: number;
  bPick: boolean;
  bQuote: boolean;
  bQty: number;
  status: string;
  total?: number; // the stored line total (what the job is charged for it)
  locked?: boolean; // already issued / returned — read-only
  waiting?: boolean; // requested from stock (เบิก) and not all issued yet
};

function RepairForm() {
  const { push } = useToast();
  const { data: PRODUCTS } = useProducts();
  const { data: SYMPTOMS } = useSymptoms();
  const { data: SYMPTOM_STATS } = useSymptomStats();
  // every job that arrives — from the URL, the search bar, or a save (setJob) — fills the form
  const { jobNo, job, loading, error, find, setJob } = useJob({
    onRecord: (j) => prefill(j),
    onLoaded: (j) => push({ kind: 'success', title: 'เรียกข้อมูลงานสำเร็จ', desc: j.no }),
    onMissing: (no) => push({ kind: 'error', title: 'ไม่พบหมายเลขงาน', desc: no }),
  });
  const { s: form, reset, adopt } = useJobForm();
  const act = useWorkflowErrors(() => find(jobNo)); // stale save → read the same job again
  const { data: MODEL_SYMPTOMS } = useModelSymptoms(form.modelCode);
  const { can, has } = useAccess();
  const lock = useMoneyLock(); // a closed job: part lines / prices stay as they are (Job Money After Close may change them)
  // a closed job keeps its status unless the role has Job Reopen (setStatus refuses it otherwise)
  const reopenLock = form.statusGroup === 'Finished' && !has('Job Reopen') ? REOPEN_LOCKED : undefined;
  const [lines, setLines] = React.useState<Line[]>([]);
  const [detail, setDetail] = React.useState({
    engineerSymptom: '',
    repairDetail: '',
    engineerRemark: '',
    newSerial: '',
    status: '',
  });
  const [saving, setSaving] = React.useState(false);
  const idRef = React.useRef(0);
  // what prefill last put on screen (the job as loaded / saved) — anything else is an unsaved edit
  const [saved, setSaved] = React.useState<{ detail: typeof detail; lines: Line[] } | null>(null);
  useUnsavedChanges(!!saved && JSON.stringify({ detail, lines }) !== JSON.stringify(saved));

  // prefill form, repair details and spare-part requests from the loaded job
  function prefill(job: JobDetail) {
    reset(fromJob(job));
    const next = {
      detail: {
        engineerSymptom: job.engineerSymptom,
        repairDetail: job.repairDetail,
        engineerRemark: job.engineerRemark,
        newSerial: '',
        // the job's own status even when the list does not offer it (closed, out-source…): saved unchanged = kept
        status: job.status,
      },
      lines: job.parts.map((p) => ({
        id: ++idRef.current,
        logId: p.logId,
        code: p.code,
        name: p.name,
        price: p.unitPrice,
        aPick: p.isSpecial,
        aQuote: p.isQuotation,
        aQty: p.requested,
        bPick: p.isSpecialB,
        bQuote: p.isQuotationB,
        bQty: p.requestQtyB,
        status: p.status,
        total: p.total,
        locked: p.statusId !== 1 || p.granted > 0,
        waiting: p.statusId === 1 && p.isSpecial && p.requested > p.granted,
      })),
    };
    setDetail(next.detail);
    setLines(next.lines);
    setSaved(next);
  }

  const go = (v: string) => find(v);

  // POST /api/jobs/:no/repair → job fields, costs, job_order_spare_part_log (+ booking), status + job_log
  const save = async () => {
    if (!job) return; // the save bar only shows once a job is loaded (RecordGate)
    const body = {
      ...detail,
      status: detail.status || undefined,
      serviceCost: form.serviceCost,
      toolCost: form.toolCost,
      deliveryCost: form.deliveryCost,
      boxCost: form.boxCost,
      parts: lines.map((l) => ({
        logId: l.logId,
        code: l.code,
        unitPrice: l.price,
        a: { pick: l.aPick, quote: l.aQuote, qty: l.aQty },
        b: { pick: l.bPick, quote: l.bQuote, qty: l.bQty },
      })),
    };
    const canEdit = can('Job Management', 'edit');
    if (!act.check(repairActionSchema, body, canEdit)) return;
    if (partsBlock) return push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: partsBlock });
    setSaving(true);
    try {
      // product / other-info sections shown on this screen are saved too
      const common = await saveCommonSections(job.no, form, canEdit);
      adopt(common);
      // the version as of now: someone else's save since the page loaded → 409 (reload) instead of
      // silently cancelling the part requests they added
      const d = await postJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(job.no)}/repair`, {
        ...body,
        version: common.version ?? form.version,
      });
      setJob(d.job);
      push({ kind: 'success', title: 'บันทึกงานซ่อมเรียบร้อย', desc: `${d.job.no} · ${d.job.status}` });
    } catch (e) {
      if (!act.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const addPart = (code: string) => {
    const p = PRODUCTS.find((x) => x.sysCode === code);
    if (!p) return;
    setLines((s) => [
      ...s,
      {
        id: ++idRef.current,
        code: p.sysCode,
        name: p.name,
        price: p.price,
        aPick: true,
        aQuote: true,
        aQty: 1,
        bPick: false,
        bQuote: false,
        bQty: 0,
        status: p.onhand > 0 ? 'พร้อมเบิก' : 'รออะไหล่',
      },
    ]);
  };

  const upd = (id: number, patch: Partial<Line>) =>
    setLines((s) => s.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  // part-line rule errors ("parts.<row>.a.qty" …) — listed under the table by row number
  const partErrors = Object.entries(act.errors).filter(([k]) => k.startsWith('parts.'));
  // the quotation (ยอดเสนอราคา) — not the bill: a เสนอ-only line is quoted, not charged
  const totalA = lines.reduce((s, l) => s + (l.aQuote ? l.price * l.aQty : 0), 0);
  const totalB = lines.reduce((s, l) => s + (l.bQuote ? l.price * l.bQty : 0), 0);
  const chargeOf = (l: Line) => partCharge({ pick: l.aPick, quote: l.aQuote, qty: l.aQty }, l.price);
  // what the job charges (ค่าอะไหล่ in the summary) = what saveRepair stores: the stored total while no line
  // changed; otherwise issued / returned lines keep their stored amount, the others เบิก + เสนอ only
  const linesEdited = !!saved && JSON.stringify(lines) !== JSON.stringify(saved.lines);
  const charged = linesEdited
    ? lines.reduce((s, l) => s + (l.locked ? (l.total ?? 0) : chargeOf(l)), 0)
    : (job?.partsCost ?? 0);
  // the server refuses the change to ซ่อมเสร็จ / ไม่ซ่อม while these are not issued — say so before saving
  const notIssued = lines.filter((l) => (l.locked ? l.waiting : l.aPick && l.aQty > 0));
  const statusChange = detail.status !== job?.status && notIssued.length > 0;
  const partsBlock =
    statusChange && REPAIRED.includes(detail.status)
      ? partsNotIssuedMsg(notIssued)
      : statusChange && NO_REPAIR.includes(detail.status) && !NO_REPAIR.includes(job?.status ?? '')
        ? partsWaitingMsg(notIssued, detail.status)
        : undefined;
  /** column เป็นเงิน of แบบ A: the line's charge — a quoted line not ticked เบิก is not charged */
  const amountA = (l: Line) =>
    l.aQuote && !l.aPick && l.aQty > 0 ? 'ไม่คิดเงิน' : baht(l.locked ? (l.total ?? 0) : chargeOf(l));
  // a closed job keeps its status (Job Reopen may re-open it: setStatus); otherwise its own one comes first
  const statusOptions =
    reopenLock && job
      ? [job.status]
      : job && !REPAIR_STATUS_OPTIONS.includes(job.status)
        ? [job.status, ...REPAIR_STATUS_OPTIONS]
        : REPAIR_STATUS_OPTIONS;
  const statusOf = (l: Line) => (!l.locked && !l.aPick ? QUOTE_ONLY : l.status);
  const partTone = (st: string): Tone =>
    st === QUOTE_ONLY
      ? 'neutral'
      : /พร้อม|จ่ายแล้ว|คืนแล้ว/.test(st)
        ? 'success'
        : /รออะไหล่/.test(st)
          ? 'danger'
          : 'warning';
  const removeLine = (l: Line) =>
    !l.locked &&
    !lock && (
      <button
        onClick={() => setLines((s) => s.filter((x) => x.id !== l.id))}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
        aria-label="ลบ"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    );

  return (
    <>
      <PageHeader
        title="บันทึกงานซ่อม"
        description="ข้อมูลงาน » บันทึกการทำงาน — บันทึกอะไหล่ที่ใช้ วิธีการซ่อม และค่าใช้จ่าย"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="repair-job-no" className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              ระบุ หมายเลขงาน
            </label>
            <JobSearch id="repair-job-no" value={jobNo} scope="open" onPick={go} />
          </div>
        }
      />

      <RecordGate ready={!!job} loading={loading} error={error} noun="งาน" searchId="repair-job-no">
        <CustomerSection readOnly />

        <Section title="ข้อมูลการเปิดงานซ่อม" icon={Wrench}>
          <FieldGrid>
            <Field label="หมายเลขงานซ่อม">
              <ReadOnly>
                <span className="num">{job?.no ?? '—'}</span>
              </ReadOnly>
            </Field>
            <Field label="วันที่เปิดงานซ่อม">
              <ReadOnly>
                <span className="num">{job ? `${job.createDate} น.` : '—'}</span>
              </ReadOnly>
            </Field>
            <Field label="เปิดงานซ่อมโดย">
              <ReadOnly>{job?.createByName || '—'}</ReadOnly>
            </Field>
            <Field label="ประเภทงานซ่อม">
              <ReadOnly>
                {job
                  ? `${job.jobType}${job.warranty ? ` (${job.warranty === 'IN' ? 'In-Warranty' : 'Out-Warranty'})` : ''}`
                  : '—'}
              </ReadOnly>
            </Field>
            <Field label="สถานะงานซ่อม (ปัจจุบัน)" wide>
              <ReadOnly>
                <Badge tone="warning" dot>
                  {job?.status ?? '—'}
                </Badge>
              </ReadOnly>
            </Field>
          </FieldGrid>
        </Section>

        <ProductSection title="ข้อมูลเครื่องซ่อม" variant="repair" />

        <Section
          title="การใช้อะไหล่ และการเสนอราคา"
          icon={Stethoscope}
          description={lock ?? 'เสนอราคาแบบ A (Normal) และแบบ B (VIP)'}
          bodyClassName="p-0"
        >
          {!lock && (
            <div className="flex items-center gap-2 border-b border-border p-3">
              <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <ProductPicker
                products={PRODUCTS}
                onPick={(p) => p && addPart(p.code)}
                placeholder="เพิ่มอะไหล่ — ค้นหา ชื่อ / รหัส / เลข part / ยี่ห้อ…"
                className="sm:max-w-xl"
              />
            </div>
          )}
          {/* phone: one card per line (the 14-column table does not fit) — the same fields, desktop keeps the table */}
          <ul className="divide-y divide-border md:hidden">
            {lines.length === 0 && (
              <li className="px-3 py-8 text-center text-xs text-muted-foreground">
                ยังไม่มีรายการอะไหล่ — ค้นหาในช่องด้านบนเพื่อเพิ่ม
              </li>
            )}
            {lines.map((l, i) => (
              <li key={l.id} className="space-y-2 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="num font-medium">
                      {i + 1}. {l.code}
                    </p>
                    <p className="text-xs text-muted-foreground">{l.name}</p>
                  </div>
                  <span className="num shrink-0">{baht(l.price)}</span>
                  {removeLine(l)}
                </div>
                {(['a', 'b'] as const).map((k) => {
                  const pick = k === 'a' ? l.aPick : l.bPick;
                  const quote = k === 'a' ? l.aQuote : l.bQuote;
                  const qty = k === 'a' ? l.aQty : l.bQty;
                  const off = l.locked || !!lock;
                  const T = k.toUpperCase();
                  return (
                    <div key={k} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="w-14 text-muted-foreground">แบบ {T}</span>
                      <label className="inline-flex items-center gap-1">
                        <Checkbox
                          aria-label={`เบิก แบบ ${T} ${l.code}`}
                          checked={pick}
                          disabled={off}
                          onChange={() => upd(l.id, k === 'a' ? { aPick: !pick } : { bPick: !pick })}
                        />
                        เบิก
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <Checkbox
                          aria-label={`เสนอ แบบ ${T} ${l.code}`}
                          checked={quote}
                          disabled={off}
                          onChange={() => upd(l.id, k === 'a' ? { aQuote: !quote } : { bQuote: !quote })}
                        />
                        เสนอ
                      </label>
                      <NumberInput
                        min={0}
                        max={1000}
                        placeholder="0"
                        aria-label={`จำนวน แบบ ${T} ${l.code}`}
                        value={qty}
                        disabled={off}
                        aria-invalid={!!act.errors[`parts.${i}.${k}.qty`] || undefined}
                        onChange={(n) => {
                          upd(l.id, k === 'a' ? { aQty: n } : { bQty: n });
                          act.clear(`parts.${i}.${k}.qty`);
                        }}
                        className="h-8 w-16 px-1.5 text-xs"
                      />
                      <span className="num ml-auto">{k === 'a' ? amountA(l) : baht(quote ? l.price * qty : 0)}</span>
                    </div>
                  );
                })}
                <Badge tone={partTone(statusOf(l))} dot>
                  {statusOf(l)}
                </Badge>
              </li>
            ))}
            {lines.length > 0 && (
              <li className="flex justify-between bg-muted/50 px-3 py-2 text-xs font-semibold">
                <span>
                  ยอดเสนอราคา แบบ A <span className="num text-primary">{baht(totalA)}</span>
                </span>
                <span>
                  ยอดเสนอราคา แบบ B <span className="num text-primary">{baht(totalB)}</span>
                </span>
              </li>
            )}
          </ul>
          <div className="table-scroll hidden rounded-none md:block">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                  <th rowSpan={2} className="w-10 px-2 py-2 text-left">
                    #
                  </th>
                  <th rowSpan={2} className="w-24 px-2 py-2 text-left">
                    รหัสอะไหล่
                  </th>
                  <th rowSpan={2} className="px-2 py-2 text-left">
                    รายละเอียด
                  </th>
                  <th rowSpan={2} className="w-24 px-2 py-2 text-right">
                    ราคา/หน่วย
                  </th>
                  <th colSpan={4} className="border-l border-border px-2 py-1.5 text-center">
                    เสนอราคาแบบ A (Normal)
                  </th>
                  <th colSpan={4} className="border-l border-border px-2 py-1.5 text-center">
                    เสนอราคาแบบ B (VIP)
                  </th>
                  <th rowSpan={2} className="w-24 px-2 py-2 text-left">
                    สถานะ
                  </th>
                  <th rowSpan={2} className="w-16 px-2 py-2 text-center">
                    Action
                  </th>
                </tr>
                <tr className="border-b border-border bg-muted/60 text-2xs text-muted-foreground">
                  <th className="w-14 border-l border-border px-2 py-1.5 text-center">เบิก</th>
                  <th className="w-14 px-2 py-1.5 text-center">เสนอ</th>
                  <th className="w-16 px-2 py-1.5 text-center">Qty</th>
                  <th className="w-24 px-2 py-1.5 text-right">เป็นเงิน</th>
                  <th className="w-14 border-l border-border px-2 py-1.5 text-center">เบิก</th>
                  <th className="w-14 px-2 py-1.5 text-center">เสนอ</th>
                  <th className="w-16 px-2 py-1.5 text-center">Qty</th>
                  <th className="w-24 px-2 py-1.5 text-right">เป็นเงิน</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-3 py-10 text-center text-xs text-muted-foreground">
                      ยังไม่มีรายการอะไหล่ — ค้นหาในช่องด้านบนเพื่อเพิ่ม
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => (
                    <tr key={l.id} className="border-b border-border/70 hover:bg-accent/50">
                      <td className="num px-2 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="num px-2 py-2 font-medium">{l.code}</td>
                      <td className="px-2 py-2">
                        <span className="line-clamp-2 max-w-[280px]">{l.name}</span>
                      </td>
                      <td className="num px-2 py-2 text-right">{baht(l.price)}</td>

                      <td className="border-l border-border px-2 py-2 text-center">
                        <Checkbox
                          aria-label={`เบิก แบบ A ${l.code}`}
                          checked={l.aPick}
                          disabled={l.locked || !!lock}
                          onChange={() => upd(l.id, { aPick: !l.aPick })}
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Checkbox
                          aria-label={`เสนอ แบบ A ${l.code}`}
                          checked={l.aQuote}
                          disabled={l.locked || !!lock}
                          onChange={() => upd(l.id, { aQuote: !l.aQuote })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput
                          min={0}
                          max={1000}
                          placeholder="0"
                          aria-label={`จำนวน แบบ A ${l.code}`}
                          value={l.aQty}
                          disabled={l.locked || !!lock}
                          aria-invalid={!!act.errors[`parts.${i}.a.qty`] || undefined}
                          onChange={(n) => {
                            upd(l.id, { aQty: n });
                            act.clear(`parts.${i}.a.qty`);
                          }}
                          className="h-7 w-14 px-1.5 text-xs"
                        />
                      </td>
                      <td className="num px-2 py-2 text-right">{amountA(l)}</td>

                      <td className="border-l border-border px-2 py-2 text-center">
                        <Checkbox
                          aria-label={`เบิก แบบ B ${l.code}`}
                          checked={l.bPick}
                          disabled={l.locked || !!lock}
                          onChange={() => upd(l.id, { bPick: !l.bPick })}
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Checkbox
                          aria-label={`เสนอ แบบ B ${l.code}`}
                          checked={l.bQuote}
                          disabled={l.locked || !!lock}
                          onChange={() => upd(l.id, { bQuote: !l.bQuote })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput
                          min={0}
                          max={1000}
                          placeholder="0"
                          aria-label={`จำนวน แบบ B ${l.code}`}
                          value={l.bQty}
                          disabled={l.locked || !!lock}
                          aria-invalid={!!act.errors[`parts.${i}.b.qty`] || undefined}
                          onChange={(n) => {
                            upd(l.id, { bQty: n });
                            act.clear(`parts.${i}.b.qty`);
                          }}
                          className="h-7 w-14 px-1.5 text-xs"
                        />
                      </td>
                      <td className="num px-2 py-2 text-right">{baht(l.bQuote ? l.price * l.bQty : 0)}</td>

                      <td className="px-2 py-2">
                        <Badge tone={partTone(statusOf(l))} dot>
                          {statusOf(l)}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-center">{removeLine(l)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot>
                  <tr className="bg-muted/50 font-semibold">
                    <td colSpan={7} className="px-2 py-2 text-right text-xs">
                      ยอดเสนอราคา แบบ A
                    </td>
                    <td className="num px-2 py-2 text-right text-primary">{baht(totalA)}</td>
                    <td colSpan={3} className="px-2 py-2 text-right text-xs">
                      ยอดเสนอราคา แบบ B
                    </td>
                    <td className="num px-2 py-2 text-right text-primary">{baht(totalB)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {partErrors.length > 0 && (
            <ul role="alert" className="space-y-0.5 border-t border-border px-3 py-2 text-2xs text-danger">
              {partErrors.map(([k, m]) => (
                <li key={k}>
                  แถว {Number(k.split('.')[1]) + 1}: {m}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="รายละเอียดการซ่อม" icon={Wrench}>
          <FieldGrid>
            <Field label="อาการเสียที่ตรวจพบ" wide hint="เลือกได้ 1 อาการ">
              <SymptomPicker
                multiple={false}
                value={detail.engineerSymptom ? [detail.engineerSymptom] : []}
                onChange={(names) => setDetail((d) => ({ ...d, engineerSymptom: names[0] ?? '' }))}
                options={
                  SYMPTOM_STATS.length ? SYMPTOM_STATS : SYMPTOMS.map((sy) => ({ id: Number(sy.id), name: sy.name }))
                }
                suggested={MODEL_SYMPTOMS}
                suggestedLabel="อาการที่พบบ่อยของรุ่นนี้"
                placeholder="พิมพ์ค้นหาอาการที่ตรวจพบ…"
              />
            </Field>
            <Field label="วิธีการซ่อม" className="lg:col-span-2" error={act.errors.repairDetail}>
              <Textarea
                rows={3}
                maxLength={200}
                placeholder="อธิบายขั้นตอนการซ่อมที่ดำเนินการ"
                value={detail.repairDetail}
                onChange={(e) => {
                  setDetail((d) => ({ ...d, repairDetail: e.target.value }));
                  act.clear('repairDetail');
                }}
              />
            </Field>
            <Field label="หมายเหตุ" className="lg:col-span-2" error={act.errors.engineerRemark}>
              <Textarea
                rows={3}
                maxLength={200}
                value={detail.engineerRemark}
                onChange={(e) => {
                  setDetail((d) => ({ ...d, engineerRemark: e.target.value }));
                  act.clear('engineerRemark');
                }}
              />
            </Field>
            <Field
              label="New Serial No."
              error={act.errors.newSerial}
              hint="เพิ่มต่อท้ายรายการอะไหล่ที่เปลี่ยน (ของเดิมไม่หาย)"
            >
              <Input
                className="num"
                maxLength={50}
                value={detail.newSerial}
                onChange={(e) => {
                  setDetail((d) => ({ ...d, newSerial: e.target.value }));
                  act.clear('newSerial');
                }}
              />
            </Field>
            <Field label="สถานะงานซ่อม" required error={act.errors.status ?? partsBlock} hint={reopenLock}>
              <SearchSelect
                value={detail.status}
                onChange={(v) => {
                  setDetail((d) => ({ ...d, status: v }));
                  act.clear('status');
                }}
                options={strOptions(statusOptions)}
                minWidth={360}
                searchPlaceholder="พิมพ์ชื่อสถานะ…"
              />
            </Field>
          </FieldGrid>
        </Section>

        <CostSummary partsTotal={charged} action={act} />
        <OtherInfoSection />
        <AttachmentSection jobNo={job?.no} />
        <JobHistorySection job={job} />

        <FormActions
          saveLabel="บันทึกงานซ่อม"
          onSave={save}
          saving={saving}
          denied={can('Job Repair', 'edit') ? undefined : VIEW_ONLY}
          cancelHref="/jobs/list"
          extra={
            <PrintButton
              label="พิมพ์ใบรับงาน"
              kind="job"
              no={job?.no ?? ''}
              profileId={job?.documentProfileId}
              href={`/print/job/${encodeURIComponent(job?.no ?? '')}`}
              disabled={!job}
            />
          }
        />
      </RecordGate>
    </>
  );
}

export default function RepairPage() {
  return (
    <JobFormProvider>
      <React.Suspense fallback={null}>
        <RepairForm />
      </React.Suspense>
    </JobFormProvider>
  );
}
