'use client';

import * as React from 'react';
import { Truck, PackageCheck, ClipboardList } from 'lucide-react';
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
  JobEditLock,
} from '@/components/shared/job-form';
import { Tabs } from '@/components/ui/tabs';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGrid, ReadOnly } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { JOB_STATUS_OPTIONS } from '@/data/options';
import { useVendors, useStaff, useJobStatuses } from '@/data/db';
import { JS } from '@/lib/status-ids';
import { SEND_STATUS } from '@/lib/outsource-status';
import { RecordGate } from '@/components/shared/record-gate';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useJob, type JobDetail } from '@/lib/use-job';
import { RecordKey } from '@/lib/use-record';
import { jobNoParam } from '@/data/keys';
import { useAccess } from '@/lib/use-access';
import { postJson, errMsg } from '@/lib/api';
import { today as thaiToday } from '@/lib/dates';
import { outsourceActionSchema, RECEIVE_DATE_REQUIRED } from '@/lib/validation/job';
import { useTourRestore } from '@/components/tour/tour';

/** the statuses this page sets (saveOutsource refuses others; the job's own status is kept as an option) */
const OUTSOURCE_IDS: number[] = [JS.OUTSOURCE_SENT, JS.OUTSOURCE_RECEIVED];
const OUTSOURCE_FALLBACK = JOB_STATUS_OPTIONS.filter((s) => s.includes('Out-Source')); // until job_statuses loads
/** receiving back needs its date (saveOutsource says the same) */
const receiveSchema = outsourceActionSchema.refine((v) => !!v.receive?.date, {
  path: ['receive', 'date'],
  message: RECEIVE_DATE_REQUIRED,
});

function OutsourceForm() {
  const { push } = useToast();
  const { data: VENDORS, ...vendorsLookup } = useVendors();
  const { data: STAFF, ...staffLookup } = useStaff();
  const { data: JOB_STATUSES } = useJobStatuses();
  const outsourceStatuses = JOB_STATUSES.length
    ? JOB_STATUSES.filter((x) => OUTSOURCE_IDS.includes(x.id)).map((x) => x.name)
    : OUTSOURCE_FALLBACK;
  const { userId: meId, can } = useAccess();
  const jobLocked = !can('Job Management', 'edit'); // the shared job sections: commonSections leaves them out
  // every job that arrives — from the URL, the search bar, or a save (setJob) — fills the form
  const { jobNo, job, loading, error, find, setJob } = useJob({ onRecord: (j) => prefill(j) });
  const { s: form, reset, set } = useJobForm();
  const act = useWorkflowErrors(() => find(jobNo)); // stale save → read the same job again
  const [tab, setTab] = React.useState('device');
  const [saving, setSaving] = React.useState(false);
  const [d, setD] = React.useState({
    repairDetail: '',
    sendTo: '',
    sendDate: '',
    sendBy: '', // app_user id (SearchSelect values are strings)
    sendDetail: '',
    recvFrom: '',
    recvDate: '',
    recvBy: '',
    recvDetail: '',
    status: '',
  });
  // editing a field clears its error (keys = the payload paths the rules report)
  const ERR_KEY: Partial<Record<keyof typeof d, string>> = {
    sendTo: 'send.to',
    sendDate: 'send.date',
    sendBy: 'send.by',
    sendDetail: 'send.detail',
    recvBy: 'receive.by',
    recvDetail: 'receive.detail',
    repairDetail: 'repairDetail',
    recvDate: 'receive.date',
    status: 'status',
  };
  const upd = (p: Partial<typeof d>) => {
    setD((x) => ({ ...x, ...p }));
    (Object.keys(p) as (keyof typeof d)[]).forEach((k) => ERR_KEY[k] && act.clear(ERR_KEY[k]));
  };
  // what prefill last put on screen (the job as loaded / saved) — anything else is an unsaved edit
  const [saved, setSaved] = React.useState<typeof d | null>(null);
  useUnsavedChanges(!!saved && JSON.stringify(d) !== JSON.stringify(saved));
  useTourRestore(() => d, setD); // a บทสอน leaves the send / receive fields as it found them

  // prefill from the job + its latest job_send_forward_dt row
  function prefill(job: JobDetail) {
    reset(fromJob(job));
    const last = job.outsource[job.outsource.length - 1];
    const today = thaiToday(); // Thai calendar, not UTC
    const next = {
      repairDetail: job.repairDetail,
      sendTo: last?.sendTo ?? '',
      sendDate: last?.sendDate || today,
      sendBy: String(last?.sendById || meId),
      sendDetail: last?.sendDetail ?? '',
      recvFrom: last?.sendTo ?? '', // received back from the vendor it was sent to (no column of its own)
      recvDate: last?.receiveDate ?? '',
      recvBy: last?.receiveById ? String(last.receiveById) : '',
      recvDetail: last?.receiveDetail ?? '',
      // the job's current status, so saving without a change keeps it (the field is required)
      status: job.status,
    };
    upd(next);
    setSaved(next);
  }

  const go = (v: string) => find(v);

  const open = job?.outsource.find((o) => o.status === SEND_STATUS.SENT);
  // already received: saving again sends the receive block too (its note / date / person may be edited) —
  // a legacy row received without a date is saved with the send block only
  const back = !open && job?.outsource.at(-1)?.status === SEND_STATUS.RECEIVED && !!d.recvDate;

  // POST /api/jobs/:no/outsource → job_send_forward_dt (send / receive) + status 14/15 + job_log
  const save = async () => {
    if (!job) return; // the save bar only shows once a job is loaded (RecordGate)
    const sendTo = d.sendTo.trim();
    const receiving = !!open && (d.recvDate || d.recvDetail);
    const body = {
      symptomOther: form.symptomOther,
      repairDetail: d.repairDetail,
      send: !receiving
        ? { to: sendTo, date: d.sendDate, detail: d.sendDetail, by: Number(d.sendBy) || undefined }
        : undefined,
      receive:
        receiving || back
          ? { from: d.recvFrom, date: d.recvDate, detail: d.recvDetail, by: Number(d.recvBy || meId) || undefined }
          : undefined,
      status: d.status || undefined,
    };
    const canEdit = !jobLocked;
    if (!act.check(receiving || back ? receiveSchema : outsourceActionSchema, body, canEdit)) return;
    setSaving(true);
    try {
      // the version the page loaded: someone else's save since → 409 (reload), not overwritten
      const r = await postJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(job.no)}/outsource`, {
        ...body,
        job: commonSections(form, canEdit), // the shared sections: saved with the action or not at all
        version: form.version,
      });
      setJob(r.job);
      push({ kind: 'success', title: 'บันทึกข้อมูลส่งซ่อมต่อแล้ว', desc: `${r.job.no} · ${r.job.status}` });
    } catch (e) {
      if (!act.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  // ส่งโดย / รับโดย store the person's app_user id; someone already saved on this job who is no
  // longer in the staff list (left) stays selectable so they are not silently replaced
  const staffOptions = React.useMemo(() => {
    const opts = STAFF.map((st) => ({
      value: String(st.id),
      label: st.name,
      sub: st.id === meId ? 'ฉัน' : st.userType || undefined,
    }));
    const last = job?.outsource[job.outsource.length - 1];
    const saved = [
      { id: last?.sendById, name: last?.sendBy },
      { id: last?.receiveById, name: last?.receiveBy },
    ];
    for (const p of saved) {
      if (p.id && !opts.some((o) => o.value === String(p.id)))
        opts.unshift({ value: String(p.id), label: p.name || `#${p.id}`, sub: 'ไม่อยู่ในรายชื่อปัจจุบัน' });
    }
    return opts;
  }, [STAFF, meId, job]);

  return (
    <>
      <PageHeader
        title="บันทึกงานส่งซ่อมต่อ (Out-Source)"
        description="ข้อมูลงานซ่อม » บันทึกข้อมูลส่งซ่อม Out-Source"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="outsource-job-no" className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              ระบุ หมายเลขงานซ่อม
            </label>
            <JobSearch id="outsource-job-no" value={jobNo} scope="open" onPick={go} />
          </div>
        }
      />

      <RecordGate ready={!!job} loading={loading} error={error} noun="งาน" searchId="outsource-job-no">
        <CustomerSection readOnly />

        <Section title="ข้อมูลการเปิดงานซ่อม" icon={ClipboardList}>
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
            <Field label="สถานะงานซ่อม (ปัจจุบัน)">
              <ReadOnly>
                <Badge tone="info" dot>
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
            { key: 'device', label: 'ข้อมูลเครื่องซ่อม' },
            { key: 'detail', label: 'รายละเอียดการซ่อม' },
          ]}
        >
          {tab === 'device' ? (
            <JobEditLock locked={jobLocked}>
              <ProductSection title="ข้อมูลเครื่องซ่อม" variant="repair" />
            </JobEditLock>
          ) : (
            <Section title="รายละเอียดการซ่อม" icon={ClipboardList}>
              <FieldGrid>
                <JobEditLock locked={jobLocked} className="col-span-full">
                  <MainSymptomField />
                </JobEditLock>
                <Field label="อาการเสีย (อื่นๆ)" className="lg:col-span-2" error={act.errors.symptomOther}>
                  <Textarea
                    rows={2}
                    maxLength={200}
                    value={form.symptomOther}
                    onChange={(e) => set('symptomOther', e.target.value)}
                  />
                </Field>
                <Field label="วิธีการซ่อมเบื้องต้น" wide error={act.errors.repairDetail}>
                  <Textarea
                    rows={3}
                    maxLength={200}
                    value={d.repairDetail}
                    onChange={(e) => upd({ repairDetail: e.target.value })}
                  />
                </Field>
              </FieldGrid>
            </Section>
          )}
        </Tabs>

        <Section title="รายละเอียด การส่งงานซ่อม" icon={Truck}>
          <FieldGrid>
            <Field
              label="ส่งไปยัง"
              required
              error={act.errors['send.to']}
              className="lg:col-span-2"
              lookup={vendorsLookup}
            >
              {/* ผู้รับซ่อมต่อที่เคยส่ง (job_send_forward_dt.send_to_name, ใช้บ่อยก่อน) เป็นรายการแนะนำ — ร้านใหม่พิมพ์ได้เลย */}
              <Input
                list="outsource-vendor-options"
                maxLength={50}
                placeholder="- - เลือกหรือพิมพ์ชื่อผู้รับซ่อมต่อ - -"
                value={d.sendTo}
                onChange={(e) => upd({ sendTo: e.target.value })}
              />
              <datalist id="outsource-vendor-options">
                {VENDORS.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Field>
            <Field label="วันที่ส่ง" required error={act.errors['send.date']}>
              <Input type="date" value={d.sendDate} onChange={(e) => upd({ sendDate: e.target.value })} />
            </Field>
            <Field label="ส่งโดย (ค่าเริ่มต้น: ผู้บันทึก)" error={act.errors['send.by']} lookup={staffLookup}>
              <SearchSelect
                value={d.sendBy}
                onChange={(v) => upd({ sendBy: v })}
                options={staffOptions}
                searchPlaceholder="พิมพ์ชื่อผู้ส่ง…"
              />
            </Field>
            <Field label="หมายเหตุการส่ง" wide error={act.errors['send.detail']}>
              <Textarea
                rows={2}
                maxLength={100}
                value={d.sendDetail}
                onChange={(e) => upd({ sendDetail: e.target.value })}
              />
            </Field>
          </FieldGrid>
        </Section>

        <Section title="รายละเอียด การรับคืนงานซ่อม" icon={PackageCheck}>
          <FieldGrid>
            {/* the vendor it was sent to: job_send_forward_dt has no column of its own for it */}
            <Field label="รับจาก" className="lg:col-span-2">
              <ReadOnly>{d.recvFrom || '—'}</ReadOnly>
            </Field>
            <Field label="วันที่รับ" required={!!open} error={act.errors['receive.date']}>
              <Input type="date" value={d.recvDate} onChange={(e) => upd({ recvDate: e.target.value })} />
            </Field>
            <Field label="รับโดย" error={act.errors['receive.by']} lookup={staffLookup}>
              <SearchSelect
                value={d.recvBy || String(meId)}
                onChange={(v) => upd({ recvBy: v })}
                options={staffOptions}
                searchPlaceholder="พิมพ์ชื่อผู้รับ…"
              />
            </Field>
            <Field label="หมายเหตุการรับคืน" wide error={act.errors['receive.detail']}>
              <Textarea
                rows={2}
                maxLength={100}
                value={d.recvDetail}
                onChange={(e) => upd({ recvDetail: e.target.value })}
              />
            </Field>
            <Field label="โปรดระบุ สถานะงานซ่อม" required wide error={act.errors.status}>
              <SearchSelect
                value={d.status}
                onChange={(v) => upd({ status: v })}
                options={strOptions(
                  // รับคืนแล้ว: only with the receive date filled in (the save refuses it otherwise)
                  (job && !outsourceStatuses.includes(job.status)
                    ? [job.status, ...outsourceStatuses]
                    : outsourceStatuses
                  ).filter((n) => d.recvDate || n === job?.status || n === d.status || !/รับคืนจาก Out-Source/.test(n)),
                )}
                searchPlaceholder="พิมพ์ชื่อสถานะ…"
              />
            </Field>
          </FieldGrid>
        </Section>

        <JobEditLock locked={jobLocked}>
          <CostSummary />
        </JobEditLock>
        <AttachmentSection jobNo={job?.no} files={job?.attachments} />

        <FormActions
          saveLabel="บันทึกข้อมูล Out-Source"
          onSave={save}
          saving={saving}
          cancelHref="/jobs/list"
          denied={can('Job Repair', 'edit') ? undefined : VIEW_ONLY}
        />
      </RecordGate>
    </>
  );
}

export default function OutsourcePage() {
  return (
    <JobScreen>
      <RecordKey of={jobNoParam}>
        <OutsourceForm />
      </RecordKey>
    </JobScreen>
  );
}
