'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { JobSearch } from '@/components/shared/job-search';
import {
  CustomerSection,
  ProductSection,
  FormActions,
  VIEW_ONLY,
  JobScreen,
  useJobForm,
  fromJob,
  commonSections,
  useWorkflowErrors,
  useMoneyLock,
} from '@/components/shared/job-form';
import { useConfirm } from '@/components/ui/confirm';
import { useAccess } from '@/lib/use-access';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useShippers } from '@/data/db';
import { baht } from '@/lib/utils';
import { RecordGate } from '@/components/shared/record-gate';
import { JobHistorySection } from '@/components/shared/job-history';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useJob, type JobDetail } from '@/lib/use-job';
import { RecordKey } from '@/lib/use-record';
import { jobIdParam } from '@/data/keys';
import { PrintButton } from '@/components/shared/print-button';
import { ClosePaymentSection } from '@/components/jobs/close-payment';
import { CloseJobInfoSection, CloseReturnSection, CloseWorkSection } from '@/components/jobs/close-sections';
import {
  type CloseDraft,
  CLOSE_ERR_KEY,
  EMPTY_CLOSE,
  closeDraftOf,
  costRows,
  netOf,
} from '@/components/jobs/close-money';
import { postJson, errMsg, uploadFile } from '@/lib/api';
import { today as thaiToday } from '@/lib/dates';
import {
  closePaymentEdited,
  closeSchema,
  isSwap,
  jobBalance,
  notClosableMsg,
  partsWaitingMsg,
} from '@/lib/validation/job';
import { useTourRestore } from '@/components/tour/tour';
import { profileLock } from '@/lib/profile-lock';

function CloseForm() {
  const { push } = useToast();
  const { data: SHIPPERS, ...shippersLookup } = useShippers();
  const { jobNo, job, loading, error, find, setJob } = useJob({ onRecord: (j) => prefill(j) });
  const { s: form, reset } = useJobForm();
  const act = useWorkflowErrors(() => find(job?.id ?? ''));
  const { can } = useAccess();
  const confirm = useConfirm();
  // a closed job: the payment stays as recorded (Job Money After Close may change it); a legacy job's
  // payment already recorded: System Admin only (an empty one may be filled)
  const lock = useMoneyLock('payment');
  const [tab, setTab] = React.useState('product');
  const [saving, setSaving] = React.useState(false);
  const [d, setD] = React.useState<CloseDraft>(EMPTY_CLOSE);
  const upd = (p: Partial<typeof d>) => {
    setD((x) => ({ ...x, ...p }));
    (Object.keys(p) as (keyof typeof d)[]).forEach((k) => CLOSE_ERR_KEY[k] && act.clear(CLOSE_ERR_KEY[k]));
  };
  const [slip, setSlip] = React.useState('');
  // what prefill last put on screen (the job as loaded / saved) — anything else is an unsaved edit
  // (the slip is not: an upload is saved to the job right away)
  const [saved, setSaved] = React.useState<typeof d | null>(null);
  useUnsavedChanges(!!saved && JSON.stringify(d) !== JSON.stringify(saved));
  useTourRestore(() => d, setD);
  // สลิปชำระเงิน → bucket oneservice/jobs/{no}/slip/… (path เก็บใน job.job_payment_slip_file_name)
  const onPickSlip = async (f: File | undefined) => {
    if (!f || !job) return;
    try {
      const r = await uploadFile('job-slip', job.no, f);
      setSlip(r.path);
      push({ kind: 'success', title: 'อัปโหลดสลิปแล้ว', desc: f.name });
    } catch (e) {
      push({ kind: 'error', title: 'อัปโหลดสลิปไม่สำเร็จ', desc: errMsg(e) });
      return false;
    }
  };

  // a status ปิดงาน refuses (closeJob): said as soon as the job is loaded, not after the form is filled
  const shut = job ? notClosableMsg(job.statusId, job.statusGroup, job.status) : '';
  const net = netOf(costRows(job));
  // a part requested from stock (เบิก) not issued yet → the server refuses a close of an open job (setStatus)
  const waiting = job?.parts.filter((p) => p.statusId === 1 && p.isSpecial && p.requested > p.granted) ?? [];
  const partsWait =
    waiting.length && job?.statusGroup !== 'Finished' && d.status ? partsWaitingMsg(waiting, d.status) : undefined;
  const deposit = job?.depositCost ?? 0;
  // the payment is sent only when the user edited it (never on a locked job) — otherwise the stored one stays
  const paid = closePaymentEdited(d, saved, !!lock);
  // paying less than due is allowed but never silent: shown here and confirmed at save
  const bal = jobBalance(net, deposit, paid ? Number(d.payAmount || 0) : (job?.payment.amount ?? 0));

  function prefill(job: JobDetail) {
    reset(fromJob(job));
    setSlip(job.payment.slip);
    const next = closeDraftOf(job, SHIPPERS, thaiToday()); // Thai calendar, not UTC
    upd(next);
    setSaved(next);
  }

  const go = (v: string) => find(v);

  const save = async () => {
    if (!job) return;
    const p = job.payment;
    // deposit more than the total: a refund instead of a payment — asked while none is recorded, sent when edited
    const refundOn = bal.refund > 0 && !lock;
    const refundNeeded = refundOn && p.amount === 0;
    const refundEdited = (['refType', 'refAmount', 'refDate'] as const).some((k) => d[k] !== saved?.[k]);
    const body = {
      // only what the user edited (closePaymentEdited): untouched = the stored payment / refund stays as it is
      payment:
        paid && bal.refund === 0
          ? { type: d.payType, amount: d.payAmount, date: d.payDate, no: d.payNo, detail: d.payDetail }
          : undefined,
      refund:
        refundNeeded || (refundOn && refundEdited)
          ? { type: d.refType, amount: d.refAmount, date: d.refDate }
          : undefined,
      return: {
        type: d.returnType,
        date: d.returnDate,
        courier: d.courier,
        tracking: d.tracking,
        detail: d.returnDetail,
        shipperId: d.shipperId || undefined,
      },
      status: d.status,
      newSerial: isSwap(job.swap.detail) ? d.newSerial : undefined,
    };
    const canEdit = can('Job Management', 'edit');
    // the receipt / parcel no as loaded: an unchanged legacy value still passes
    const prev = {
      payNo: saved?.payNo,
      tracking: saved?.tracking,
      newSerial: saved?.newSerial,
      refund: { max: bal.refund, required: refundNeeded },
    };
    if (!act.check(closeSchema(prev), body, canEdit)) {
      if ((paid && !d.payType) || body.refund || refundNeeded) setTab('payment');
      return;
    }
    if (partsWait) return push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: partsWait });
    if (
      bal.outstanding > 0 &&
      (job.statusGroup !== 'Finished' || paid) &&
      !(await confirm({
        title: `ลูกค้าค้างชำระ ${baht(bal.outstanding)} บาท — ยืนยันปิดงาน?`,
        description: `ยอดที่ต้องชำระ ${baht(bal.due)} บาท · รับชำระ ${baht(bal.due - bal.outstanding)} บาท — ใบส่งคืนสินค้าจะพิมพ์บรรทัด "ค้างชำระ"`,
        confirmLabel: 'ยืนยันปิดงาน',
      }))
    )
      return;
    // more taken than the bill: a slip of the keyboard (250 typed onto 250 = 250,250) is never saved silently
    const over = paid ? Math.round((Number(d.payAmount || 0) - bal.due) * 100) / 100 : 0;
    if (
      over > 0 &&
      !(await confirm({
        title: `รับชำระเกินยอด ${baht(over)} บาท — ยืนยัน?`,
        description: `ยอดที่ต้องชำระ ${baht(bal.due)} บาท · กรอกรับชำระ ${baht(Number(d.payAmount || 0))} บาท — ตรวจจำนวนเงินอีกครั้ง`,
        confirmLabel: 'ยืนยันจำนวนนี้',
      }))
    )
      return;
    setSaving(true);
    try {
      // the version the page loaded: someone else's save since → 409 (reload)
      const r = await postJson<{ job: JobDetail }>(`/api/jobs/${job.id}/close`, {
        ...body,
        job: commonSections(form, canEdit), // the shared sections: saved with the action or not at all
        version: form.version,
      });
      setJob(r.job);
      push({ kind: 'success', title: 'ปิดงานและบันทึกการส่งคืนเรียบร้อย', desc: `${r.job.no} · ${r.job.status}` });
    } catch (e) {
      if (!act.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="ปิดงาน - ส่งคืนสินค้า"
        description="ข้อมูลงานบริการ » ปิดงาน-ส่งคืนสินค้า"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="close-job-no" className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              ระบุ หมายเลขงาน
            </label>
            <JobSearch id="close-job-no" value={jobNo} scope="closable" onPick={go} />
            <PrintButton
              label="พิมพ์ใบส่งคืน"
              kind="job"
              locked={profileLock('job', { closed: job?.statusGroup === 'Finished' })}
              no={job?.no ?? ''}
              profileId={job?.documentProfileId}
              href={`/print/job/${job?.id ?? ''}/return`}
              disabled={!job}
            />
            <PrintButton
              label="พิมพ์ใบปะหน้าพัสดุ"
              title="ใบปะหน้าพัสดุ A5 สำหรับส่งคืนทางขนส่ง"
              kind="job"
              locked={profileLock('job', { closed: job?.statusGroup === 'Finished' })}
              no={job?.no ?? ''}
              profileId={job?.documentProfileId}
              href={`/print/job/${job?.id ?? ''}/label`}
              disabled={!job}
            />
          </div>
        }
      />

      <RecordGate ready={!!job} loading={loading} error={error} noun="งาน" searchId="close-job-no">
        {shut && (
          <p
            role="alert"
            className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning"
          >
            {shut}
          </p>
        )}
        <CustomerSection readOnly />

        <CloseJobInfoSection job={job} />

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'product', label: 'ข้อมูลสินค้า' },
            { key: 'work', label: 'รายละเอียดการดำเนินงาน' },
            { key: 'payment', label: 'รายละเอียดการรับชำระเงิน' },
          ]}
        >
          {tab === 'product' && <ProductSection title="ข้อมูลสินค้า" />}

          {tab === 'work' && <CloseWorkSection job={job} />}

          {tab === 'payment' && (
            <ClosePaymentSection
              job={job}
              d={d}
              upd={upd}
              errors={act.errors}
              lock={lock}
              bal={bal}
              slip={slip}
              onPickSlip={onPickSlip}
            />
          )}
        </Tabs>

        <CloseReturnSection
          job={job}
          d={d}
          upd={upd}
          errors={act.errors}
          partsWait={partsWait}
          shippers={SHIPPERS}
          shippersLookup={shippersLookup}
        />
        <JobHistorySection job={job} />

        <FormActions
          saveLabel="ยืนยันปิดงาน"
          onSave={save}
          saving={saving}
          cancelHref="/jobs/list"
          denied={can('Job Closing', 'edit') ? shut || undefined : VIEW_ONLY}
        />
      </RecordGate>
    </>
  );
}

export default function ClosePage() {
  return (
    <JobScreen>
      <RecordKey of={jobIdParam}>
        <CloseForm />
      </RecordKey>
    </JobScreen>
  );
}
