'use client';

import * as React from 'react';
import { RefreshCcw, ClipboardList } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { JobSearch } from '@/components/shared/job-search';
import { Section } from '@/components/shared/section';
import {
  CustomerSection,
  ProductSection,
  MainSymptomField,
  CostSummary,
  AttachmentSection,
  FormActions,
  VIEW_ONLY,
  JobScreen,
  useJobForm,
  fromJob,
  commonSections,
  useWorkflowErrors,
  useMoneyLock,
} from '@/components/shared/job-form';
import { useAccess } from '@/lib/use-access';
import { Tabs } from '@/components/ui/tabs';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGrid, ReadOnly } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { RecordGate } from '@/components/shared/record-gate';
import { JobHistorySection } from '@/components/shared/job-history';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useJob, type JobDetail } from '@/lib/use-job';
import { RecordKey } from '@/lib/use-record';
import { jobIdParam } from '@/data/keys';
import { postJson, errMsg } from '@/lib/api';
import { today as thaiToday } from '@/lib/dates';
import { parseSwap, serialAccepts, swapRefundOf, swapRefundSchema, SWAP_STATUS_OPTIONS } from '@/lib/validation/job';
import { CodeInput } from '@/components/shared/code-input';
import { JobLinks, useJobChecks, Warn } from '@/components/jobs/job-checks';
import { useTourRestore } from '@/components/tour/tour';

function SwapRefundForm() {
  const { push } = useToast();
  // every job that arrives — from the URL, the search bar, or a save (setJob) — fills the form
  const { jobNo, job, loading, error, find, setJob } = useJob({ onRecord: (j) => prefill(j) });
  const { s: form, reset, set } = useJobForm();
  const act = useWorkflowErrors(() => find(job?.id ?? '')); // stale save → read the same job again
  const { can } = useAccess();
  // a closed job: the refund stays as recorded (Job Money After Close may change it); a legacy job's
  // payment already recorded: System Admin only (an empty one may be filled)
  const lock = useMoneyLock('payment');
  const [tab, setTab] = React.useState('product');
  const [mode, setMode] = React.useState<'swap' | 'refund'>('swap');
  const [saving, setSaving] = React.useState(false);
  const [d, setD] = React.useState({
    inspection: '',
    newSerial: '',
    newModel: '',
    swapDate: '',
    docNo: '',
    refundAmount: '',
    refundMethod: 'โอนเงินเข้าบัญชี',
    refundRef: '',
    refundDate: '',
    detail: '',
    status: '',
  });
  const upd = (p: Partial<typeof d>) => {
    setD((x) => ({ ...x, ...p }));
    Object.keys(p).forEach((k) => act.clear(k)); // payload keys = state keys here
  };
  // what prefill last put on screen (the job as loaded / saved) — anything else is an unsaved edit
  const [saved, setSaved] = React.useState<{ mode: string; d: typeof d } | null>(null);
  useUnsavedChanges(!!saved && JSON.stringify({ mode, d }) !== JSON.stringify(saved));
  // a บทสอน leaves Swap / Refund and its fields as it found them
  useTourRestore(
    () => ({ mode, d }),
    (v) => {
      setMode(v.mode);
      setD(v.d);
    },
  );

  function prefill(job: JobDetail) {
    reset(fromJob(job));
    const sw = parseSwap(job.swap.detail);
    const today = thaiToday(); // Thai calendar, not UTC
    const refund = !!swapRefundOf(job.swap.detail); // not a deposit given back at the close (swapRefundOf)
    const next = {
      inspection: job.repairDetail,
      newSerial: (sw['New S/N'] ?? '').trim(),
      newModel: sw['รุ่นที่เปลี่ยนให้'] ?? '',
      // today only for a first swap — a stored (legacy) detail without a date saved unchanged writes nothing
      swapDate: sw['วันที่เปลี่ยนเครื่อง'] || (job.swap.detail.trim() ? '' : today),
      docNo: job.swap.docNo,
      refundAmount: sw['ยอดเงินคืน'] ?? '',
      refundMethod: sw['วิธีการคืนเงิน'] || 'โอนเงินเข้าบัญชี',
      refundRef: sw['เลขที่บัญชี/อ้างอิง'] ?? '',
      refundDate: sw['วันที่คืนเงิน'] || today,
      detail: sw['รายละเอียด'] ?? (job.swap.detail && Object.keys(sw).length === 0 ? job.swap.detail : ''),
      // the job's current status, so saving without a change keeps it (the field is required)
      status: job.status,
    };
    setMode(refund ? 'refund' : 'swap');
    upd(next);
    setSaved({ mode: refund ? 'refund' : 'swap', d: next });
  }

  const go = (v: string) => find(v);

  // the new device's serial already on another job (one typed wrong, or a device given out twice) — a warning
  // only, asked once the typing settles and only for a serial changed from the one saved
  const asSerial = (serial: string) => ({ ...form, serial, so: '', shopName: '' });
  const newSerialSeen =
    useJobChecks(asSerial(d.newSerial), asSerial(saved?.d.newSerial ?? ''), mode === 'swap')?.serial.jobs ?? [];

  // POST /api/jobs/:id/swap-refund → swap_refund_detail / document_no / payment (refund) + status + job_log
  const save = async () => {
    if (!job) return; // the save bar only shows once a job is loaded (RecordGate)
    const body =
      mode === 'swap'
        ? {
            inspection: d.inspection,
            newSerial: d.newSerial,
            newModel: d.newModel,
            swapDate: d.swapDate,
            docNo: d.docNo,
            detail: d.detail,
            status: d.status || undefined,
          }
        : {
            inspection: d.inspection,
            refundAmount: d.refundAmount,
            refundMethod: d.refundMethod,
            refundRef: d.refundRef,
            refundDate: d.refundDate,
            docNo: d.docNo,
            detail: d.detail,
            status: d.status || undefined,
          };
    const canEdit = can('Job Management', 'edit');
    // the job's total with the cost sections as typed (they save with the action); unchanged stored values pass
    const total = form.partsCost + form.serviceCost + form.toolCost + form.deliveryCost + form.boxCost;
    if (!act.check(swapRefundSchema({ total, prev: saved?.d }), body, canEdit)) return;
    setSaving(true);
    try {
      // the version the page loaded: someone else's save since → 409 (reload), not overwritten
      const r = await postJson<{ job: JobDetail }>(`/api/jobs/${job.id}/swap-refund`, {
        ...body,
        job: commonSections(form, canEdit), // the shared sections: saved with the action or not at all
        version: form.version,
      });
      setJob(r.job);
      push({
        kind: 'success',
        title: mode === 'swap' ? 'บันทึกการเปลี่ยนเครื่องแล้ว' : 'บันทึกการคืนเงินแล้ว',
        desc: `${r.job.no} · ${r.job.status}`,
      });
    } catch (e) {
      if (!act.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="บันทึกงาน Swap / Refund"
        description="ข้อมูลงานบริการ » บันทึกข้อมูล (Swap / Refund)"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="swap-job-no" className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              ระบุ หมายเลขงาน
            </label>
            <JobSearch id="swap-job-no" value={jobNo} scope="open" onPick={go} />
          </div>
        }
      />

      <RecordGate ready={!!job} loading={loading} error={error} noun="งาน" searchId="swap-job-no">
        <CustomerSection readOnly />

        <Section title="ข้อมูลการเปิดงาน" icon={ClipboardList}>
          <FieldGrid>
            <Field label="หมายเลขงาน">
              <ReadOnly>
                <span className="num">{job?.no ?? '—'}</span>
              </ReadOnly>
            </Field>
            <Field label="วันที่เปิดงาน">
              <ReadOnly>
                <span className="num">{job ? `${job.createDate} น.` : '—'}</span>
              </ReadOnly>
            </Field>
            <Field label="เปิดงานโดย">
              <ReadOnly>{job?.createByName || '—'}</ReadOnly>
            </Field>
            <Field label="สถานะงาน (ปัจจุบัน)">
              <ReadOnly>
                <Badge tone="warning" dot>
                  {job?.status ?? '—'}
                </Badge>
              </ReadOnly>
            </Field>
          </FieldGrid>
        </Section>

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'product', label: 'ข้อมูลสินค้า' },
            { key: 'detail', label: 'รายละเอียดการซ่อม' },
          ]}
        >
          {tab === 'product' ? (
            <ProductSection title="ข้อมูลสินค้า" variant="repair" />
          ) : (
            <Section title="รายละเอียดการซ่อม" icon={ClipboardList}>
              <FieldGrid>
                <MainSymptomField />
                <Field label="อาการเสีย (อื่นๆ)" className="lg:col-span-2">
                  <Textarea rows={2} value={form.symptomOther} onChange={(e) => set('symptomOther', e.target.value)} />
                </Field>
                <Field label="ผลการตรวจสอบ" wide error={act.errors.inspection}>
                  <Textarea
                    rows={3}
                    maxLength={200}
                    value={d.inspection}
                    onChange={(e) => upd({ inspection: e.target.value })}
                  />
                </Field>
              </FieldGrid>
            </Section>
          )}
        </Tabs>

        <Section title="ข้อมูลการดำเนินงาน" icon={RefreshCcw}>
          <div role="group" aria-label="Swap หรือ Refund" className="mb-4 flex gap-2">
            {(
              [
                { k: 'swap', l: 'Swap — เปลี่ยนเครื่องใหม่' },
                { k: 'refund', l: 'Refund — คืนเงิน' },
              ] as const
            ).map((o) => (
              <button
                key={o.k}
                aria-pressed={mode === o.k}
                onClick={() => {
                  setMode(o.k);
                  // a status of the other mode's list goes (the server would refuse it); the job's own one stays
                  if (d.status && d.status !== job?.status && !SWAP_STATUS_OPTIONS[o.k].includes(d.status))
                    upd({ status: '' });
                }}
                className={
                  'flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ' +
                  (mode === o.k
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-input')
                }
              >
                {o.l}
              </button>
            ))}
          </div>

          <FieldGrid>
            {mode === 'swap' ? (
              <>
                <Field label="New Serial No." error={act.errors.newSerial}>
                  <CodeInput
                    className="num"
                    maxLength={50}
                    value={d.newSerial}
                    onChange={(e) => upd({ newSerial: e.target.value })}
                    accepts={serialAccepts}
                    onFix={(v) => upd({ newSerial: v })}
                  />
                  {!!newSerialSeen.length && (
                    <Warn>
                      S/N นี้อยู่ในงานอื่นแล้ว: <JobLinks jobs={newSerialSeen} /> (เปิดแท็บใหม่) — ตรวจ S/N
                      เครื่องใหม่อีกครั้ง
                    </Warn>
                  )}
                </Field>
                <Field label="รุ่นที่เปลี่ยนให้">
                  <Input value={d.newModel} onChange={(e) => upd({ newModel: e.target.value })} />
                </Field>
                <Field label="วันที่เปลี่ยนเครื่อง" error={act.errors.swapDate}>
                  <Input type="date" value={d.swapDate} onChange={(e) => upd({ swapDate: e.target.value })} />
                </Field>
                <Field label="เลขที่เอกสารเบิกสินค้า" error={act.errors.docNo}>
                  <Input
                    className="num"
                    maxLength={50}
                    value={d.docNo}
                    onChange={(e) => upd({ docNo: e.target.value })}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="ยอดเงินคืน (บาท)" required error={act.errors.refundAmount} hint={lock}>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={d.refundAmount}
                    disabled={!!lock}
                    onChange={(e) => upd({ refundAmount: e.target.value })}
                    onFocus={(e) => e.currentTarget.select()}
                    className="num text-right"
                  />
                </Field>
                <Field label="วิธีการคืนเงิน" required error={act.errors.refundMethod}>
                  <Select
                    value={d.refundMethod}
                    disabled={!!lock}
                    onChange={(e) => upd({ refundMethod: e.target.value })}
                  >
                    <option>โอนเงินเข้าบัญชี</option>
                    <option>เงินสด</option>
                    <option>คืนผ่านช่องทางการขาย</option>
                  </Select>
                </Field>
                <Field label="เลขที่บัญชี / อ้างอิง" error={act.errors.refundRef}>
                  <Input
                    className="num"
                    maxLength={50}
                    value={d.refundRef}
                    disabled={!!lock}
                    onChange={(e) => upd({ refundRef: e.target.value })}
                  />
                </Field>
                <Field label="วันที่คืนเงิน" error={act.errors.refundDate}>
                  <Input
                    type="date"
                    value={d.refundDate}
                    disabled={!!lock}
                    onChange={(e) => upd({ refundDate: e.target.value })}
                  />
                </Field>
              </>
            )}
            <Field label="รายละเอียด" wide>
              <Textarea rows={3} value={d.detail} onChange={(e) => upd({ detail: e.target.value })} />
            </Field>
            <Field label="โปรดระบุ สถานะงาน" required wide error={act.errors.status}>
              <SearchSelect
                value={d.status}
                onChange={(v) => upd({ status: v })}
                // the mode's list only (saveSwapRefund refuses any other); the job's own status may stay
                options={strOptions(
                  job && !SWAP_STATUS_OPTIONS[mode].includes(job.status)
                    ? [job.status, ...SWAP_STATUS_OPTIONS[mode]]
                    : SWAP_STATUS_OPTIONS[mode],
                )}
                searchPlaceholder="พิมพ์ชื่อสถานะ…"
              />
            </Field>
          </FieldGrid>
        </Section>

        <CostSummary />
        <AttachmentSection jobNo={job?.no} files={job?.attachments} />
        <JobHistorySection job={job} />

        <FormActions
          saveLabel="บันทึกข้อมูล"
          onSave={save}
          saving={saving}
          cancelHref="/jobs/list"
          denied={can('Job Management', 'edit') ? undefined : VIEW_ONLY}
        />
      </RecordGate>
    </>
  );
}

export default function SwapRefundPage() {
  return (
    <JobScreen>
      <RecordKey of={jobIdParam}>
        <SwapRefundForm />
      </RecordKey>
    </JobScreen>
  );
}
