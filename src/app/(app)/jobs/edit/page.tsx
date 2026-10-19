'use client';

import * as React from 'react';
import { Wrench } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { JobSearch } from '@/components/shared/job-search';
import { JobHistorySection } from '@/components/shared/job-history';
import { Section } from '@/components/shared/section';
import { Field, FieldGrid, ReadOnly } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { QuoteLink } from '@/components/jobs/quote-link';
import {
  CustomerSection,
  JobOpenSection,
  ProductSection,
  OtherInfoSection,
  AttachmentSection,
  FormActions,
  VIEW_ONLY,
  JobScreen,
  useJobForm,
  fromJob,
  toJobInput,
} from '@/components/shared/job-form';
import { useToast } from '@/components/ui/toast';
import { RecordGate } from '@/components/shared/record-gate';
import { useJob, type JobDetail } from '@/lib/use-job';
import { PrintButton } from '@/components/shared/print-button';
import { TrackLink } from '@/components/shared/track-link';
import { patchJson, errMsg } from '@/lib/api';
import { useAccess } from '@/lib/use-access';

function EditJobForm() {
  const { push } = useToast();
  // every job that arrives — from the URL, the search bar, or a save (setJob) — fills the form
  const { jobNo, job, loading, error, find, setJob } = useJob({ onRecord: (j) => prefill(j) });
  const { s, reset, validate, report, fromApi } = useJobForm();
  const [saving, setSaving] = React.useState(false);
  const { can } = useAccess();

  // prefill the form whenever a job is loaded (from ?job=, the search bar or a save)
  function prefill(job: JobDetail) {
    reset(fromJob(job));
  }

  const go = (v: string) => find(v);

  // PATCH /api/jobs/:no — updates the job row. Status is display-only here (it moves through the
  // workflow screens), so it is not sent: a stale value must never roll back a newer status.
  const save = async () => {
    if (!job) return; // the save bar only shows once a job is loaded (RecordGate)
    if (report(validate())) return; // a required field that had a value must keep one
    setSaving(true);
    try {
      const d = await patchJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(job.no)}`, {
        ...toJobInput(s),
        status: undefined,
      });
      setJob(d.job);
      push({ kind: 'success', title: 'บันทึกการแก้ไขงานแล้ว', desc: d.job.no });
    } catch (e) {
      if (!fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="แก้ไขข้อมูลงาน"
        description="ข้อมูลงานบริการ » แก้ไขข้อมูลงาน — ระบุหมายเลขงานเพื่อเรียกข้อมูลมาแก้ไข"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="edit-job-no" className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              ระบุ หมายเลขงาน
            </label>
            <JobSearch id="edit-job-no" value={jobNo} scope="all" onPick={go} />
          </div>
        }
      />

      <RecordGate ready={!!job} loading={loading} error={error} noun="งาน" searchId="edit-job-no">
        <CustomerSection />
        <JobOpenSection jobNo={job?.no} status={job?.status ?? 'อยู่ระหว่างดำเนินการ'} />
        <ProductSection variant="open" />
        <OtherInfoSection />
        {/* read-only: the repair (บันทึกงานซ่อม) and the close (ปิดงาน) as saved there */}
        {job && (job.repairedBy || job.closedBy || job.sparePartReplace || job.repairedDate || job.closedDate) && (
          <Section title="การซ่อม / ปิดงาน" icon={Wrench}>
            <FieldGrid>
              <Field label="ซ่อมเสร็จโดย">
                <ReadOnly>{job.repairedBy}</ReadOnly>
              </Field>
              <Field label="วันที่ซ่อมเสร็จ">
                <ReadOnly>
                  <span className="num">{job.repairedDate}</span>
                </ReadOnly>
              </Field>
              <Field label="ปิดงานโดย">
                <ReadOnly>{job.closedBy}</ReadOnly>
              </Field>
              <Field label="วันที่ปิดงาน">
                <ReadOnly>
                  <span className="num">{job.closedDate}</span>
                </ReadOnly>
              </Field>
              <Field label="อะไหล่ที่เปลี่ยน / New S/N" wide>
                <Textarea rows={2} readOnly value={job.sparePartReplace} />
              </Field>
            </FieldGrid>
          </Section>
        )}
        <AttachmentSection jobNo={job?.no} />
        {job?.no && <TrackLink jobNo={job.no} />}
        <JobHistorySection job={job} />

        <FormActions
          saveLabel="บันทึกการแก้ไข"
          onSave={save}
          saving={saving}
          cancelHref="/jobs/list"
          denied={can('Job Management', 'edit') ? undefined : VIEW_ONLY}
          extra={
            <>
              <QuoteLink jobNo={job?.no} />
              <PrintButton
                label="พิมพ์ใบรับงาน"
                kind="job"
                no={job?.no ?? ''}
                profileId={job?.documentProfileId}
                href={`/print/job/${encodeURIComponent(job?.no ?? '')}`}
                disabled={!job}
              />
              {/* a closed job is no longer on the close screen's list: its return note is printed from here */}
              {job?.statusGroup === 'Finished' && (
                <PrintButton
                  label="พิมพ์ใบส่งคืน"
                  kind="job"
                  no={job.no}
                  profileId={job.documentProfileId}
                  href={`/print/job/${encodeURIComponent(job.no)}/return`}
                />
              )}
            </>
          }
        />
      </RecordGate>
    </>
  );
}

export default function EditJobPage() {
  return (
    <JobScreen>
      <EditJobForm />
    </JobScreen>
  );
}
