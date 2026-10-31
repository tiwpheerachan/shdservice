'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { JobSearch } from '@/components/shared/job-search';
import { JobHistorySection } from '@/components/shared/job-history';
import {
  CustomerSection,
  ProductSection,
  CostSummary,
  OtherInfoSection,
  AttachmentSection,
  FormActions,
  VIEW_ONLY,
  JobScreen,
  useJobForm,
  fromJob,
  commonSections,
  useWorkflowErrors,
  useMoneyLock,
  JobEditLock,
} from '@/components/shared/job-form';
import { useAccess } from '@/lib/use-access';
import { useToast } from '@/components/ui/toast';
import type { PickableProduct } from '@/lib/product-match';
import { RecordGate } from '@/components/shared/record-gate';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useJob, type JobDetail } from '@/lib/use-job';
import { PrintButton } from '@/components/shared/print-button';
import { QuoteLink } from '@/components/jobs/quote-link';
import { RepairPartsSection } from '@/components/jobs/repair-parts';
import { RepairDetailSection, RepairJobInfoSection, type RepairDetail } from '@/components/jobs/repair-detail';
import { type Line, chargedTotal, legacyPartsTotal, partsBlockOf } from '@/components/jobs/repair-lines';
import { postJson, errMsg } from '@/lib/api';
import { repairActionSchema } from '@/lib/validation/job';
import { useTourRestore } from '@/components/tour/tour';
import { profileLock } from '@/lib/profile-lock';
import { unpack } from '@/lib/obscure';

const NO_DETAIL: RepairDetail = {
  engineerSymptom: '',
  repairDetail: '',
  engineerRemark: '',
  newSerial: '',
  status: '',
};

/** repair details and spare-part requests of a job; the lines get ids lastId + 1, + 2, … */
function repairStateOf(job: JobDetail, lastId: number): { detail: RepairDetail; lines: Line[] } {
  return {
    detail: {
      engineerSymptom: job.engineerSymptom,
      repairDetail: job.repairDetail,
      engineerRemark: job.engineerRemark,
      newSerial: '',
      // the job's own status even when the list does not offer it (closed, out-source…): saved unchanged = kept
      status: job.status,
    },
    lines: job.parts.map((p, i) => ({
      id: lastId + i + 1,
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
      locked: p.statusId !== 1 || p.figuresLocked, // issued / returned, or a legacy line (System Admin's)
      // a legacy line still pending with nothing issued: cancelling it is the normal workflow (the server allows it)
      cancellable: p.statusId === 1 && p.granted === 0 && p.figuresLocked,
      // partly issued: แบบ A's qty may come down to what stock issued (the rest is cancelled) — nothing else
      issued: p.statusId === 1 && p.granted > 0 ? { granted: p.granted, requested: p.requested } : undefined,
      waiting: p.statusId === 1 && p.isSpecial && p.requested > p.granted,
    })),
  };
}

/** `initial`: the job that came with the page — the form starts filled from it (server HTML = hydrated tree) */
function RepairForm({ initial }: { initial?: JobDetail }) {
  const { push } = useToast();
  // the job the form was built from: its mount onRecord (useRecord hands the page's record over once) is
  // already on screen; every other job that arrives — search bar, a save (setJob), a re-read — fills the form
  const builtFrom = React.useRef(initial);
  const { jobNo, job, loading, error, find, setJob } = useJob({
    onRecord: (j) => {
      const b = builtFrom.current;
      builtFrom.current = undefined;
      if (b?.id !== j.id || b.version !== j.version) prefill(j);
    },
  });
  const { s: form, reset } = useJobForm();
  const act = useWorkflowErrors(() => find(job?.id ?? ''));
  const { can } = useAccess();
  // a closed job: part lines / prices stay as they are (Job Money After Close may change them) — new lines may
  // always be added (a legacy line's own qty / price: figuresLocked on the line)
  const lock = useMoneyLock();
  // what prefill last put on screen (the job as loaded / saved) — anything else is an unsaved edit
  const [saved, setSaved] = React.useState(() => (initial ? repairStateOf(initial, 0) : null));
  const [lines, setLines] = React.useState<Line[]>(() => saved?.lines ?? []);
  const [detail, setDetail] = React.useState<RepairDetail>(() => saved?.detail ?? NO_DETAIL);
  const [saving, setSaving] = React.useState(false);
  const idRef = React.useRef(saved?.lines.length ?? 0);
  useUnsavedChanges(!!saved && JSON.stringify({ detail, lines }) !== JSON.stringify(saved));
  useTourRestore(
    () => ({ detail, lines }),
    (v) => {
      setDetail(v.detail);
      setLines(v.lines);
    },
  );

  function prefill(job: JobDetail) {
    reset(fromJob(job));
    const next = repairStateOf(job, idRef.current);
    idRef.current += next.lines.length;
    setDetail(next.detail);
    setLines(next.lines);
    setSaved(next);
  }

  const go = (v: string) => find(v);

  const save = async () => {
    if (!job) return;
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
      // the version the page loaded: someone else's save since → 409 (reload) instead of
      // silently cancelling the part requests they added
      const d = await postJson<{ job: JobDetail }>(`/api/jobs/${job.id}/repair`, {
        ...body,
        job: commonSections(form, canEdit), // the shared sections: saved with the action or not at all
        version: form.version,
      });
      setJob(d.job);
      push({ kind: 'success', title: 'บันทึกงานซ่อมเรียบร้อย', desc: `${d.job.no} · ${d.job.status}` });
    } catch (e) {
      if (!act.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const addPart = (p: PickableProduct) => {
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

  // what the job charges (ค่าอะไหล่ in the summary) = what saveRepair stores: the stored total while no line
  // changed; otherwise issued / returned lines keep their stored amount, the others เบิก + เสนอ only
  const linesEdited = !!saved && JSON.stringify(lines) !== JSON.stringify(saved.lines);
  // what saveRepair will store: a new job sums its lines; a legacy job's recorded cost moves by what changed here
  const charged = !linesEdited
    ? (job?.partsCost ?? 0)
    : job?.legacy
      ? legacyPartsTotal(lines, saved.lines, job.partsCost)
      : chargedTotal(lines);
  // the server refuses the change to ซ่อมเสร็จ / ไม่ซ่อม while these are not issued — say so before saving
  const partsBlock = partsBlockOf(lines, detail.status, job?.status);

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

        <RepairJobInfoSection job={job} />

        <JobEditLock locked={!can('Job Management', 'edit')}>
          <ProductSection title="ข้อมูลเครื่องซ่อม" variant="repair" />
        </JobEditLock>

        <RepairPartsSection lines={lines} setLines={setLines} onAdd={addPart} lock={lock} act={act} />

        <RepairDetailSection job={job} detail={detail} setDetail={setDetail} act={act} partsBlock={partsBlock} />

        {/* the costs save with the repair itself (body), the rest of the shared sections only with the right */}
        <CostSummary partsTotal={charged} action={act} />
        <JobEditLock locked={!can('Job Management', 'edit')}>
          <OtherInfoSection />
        </JobEditLock>
        <AttachmentSection jobNo={job?.no} files={job?.attachments} />
        <JobHistorySection job={job} />

        <FormActions
          saveLabel="บันทึกงานซ่อม"
          onSave={save}
          saving={saving}
          denied={can('Job Repair', 'edit') ? undefined : VIEW_ONLY}
          cancelHref="/jobs/list"
          extra={
            <>
              <QuoteLink jobId={job?.id} />
              <PrintButton
                label="พิมพ์ใบรับงาน"
                kind="job"
                locked={profileLock('job', { closed: job?.statusGroup === 'Finished' })}
                no={job?.no ?? ''}
                profileId={job?.documentProfileId}
                href={`/print/job/${job?.id ?? ''}`}
                disabled={!job}
              />
            </>
          }
        />
      </RecordGate>
    </>
  );
}

/** `jobPacked`: the job that came with the page, packed (src/lib/obscure.ts — its customer's e-mail stays out of the HTML) */
export default function RepairPage({ jobPacked }: { jobPacked?: string }) {
  const job = React.useMemo(() => (jobPacked ? (JSON.parse(unpack(jobPacked)) as JobDetail) : undefined), [jobPacked]);
  return (
    <JobScreen initial={job && fromJob(job)}>
      <RepairForm initial={job} />
    </JobScreen>
  );
}
