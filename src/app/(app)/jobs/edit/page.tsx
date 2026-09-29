"use client";

import * as React from "react";
import { PageHeader } from "@/components/shared/page-header";
import { JobSearch } from "@/components/shared/job-search";
import { JobHistorySection } from "@/components/shared/job-history";
import {
  CustomerSection,
  JobOpenSection,
  ProductSection,
  OtherInfoSection,
  AttachmentSection,
  FormActions,
  JobFormProvider,
  useJobForm,
  fromJob,
  toJobInput,
} from "@/components/shared/job-form";
import { useToast } from "@/components/ui/toast";
import { RecordGate } from "@/components/shared/record-gate";
import { useJob, type JobDetail } from "@/lib/use-job";
import { PrintButton } from "@/components/shared/print-button";
import { TrackLink } from "@/components/shared/track-link";
import { patchJson, errMsg } from "@/lib/api";

function EditJobForm() {
  const { push } = useToast();
  const { jobNo, job, loading, error, find, setJob } = useJob({
    onLoaded: (j) => push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: j.no }),
    onMissing: (no) => push({ kind: "error", title: "ไม่พบหมายเลขงาน", desc: no }),
  });
  const { s, reset, validate, report, fromApi } = useJobForm();
  const [saving, setSaving] = React.useState(false);

  // prefill the form whenever a job is loaded (from ?job= or the GO button)
  React.useEffect(() => {
    if (job) reset(fromJob(job));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const go = (v: string) => find(v);

  // PATCH /api/jobs/:no — updates the job row. Status is display-only here (it moves through the
  // workflow screens), so it is not sent: a stale value must never roll back a newer status.
  const save = async () => {
    if (!job) {
      push({ kind: "warning", title: "กรุณาระบุหมายเลขงานก่อน" });
      return;
    }
    if (report(validate())) return; // a required field that had a value must keep one
    setSaving(true);
    try {
      const d = await patchJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(job.no)}`, { ...toJobInput(s), status: undefined });
      setJob(d.job);
      push({ kind: "success", title: "บันทึกการแก้ไขงานแล้ว", desc: d.job.no });
    } catch (e) {
      if (!fromApi(e)) push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
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
        <JobOpenSection jobNo={job?.no} status={job?.status ?? "อยู่ระหว่างดำเนินการ"} />
        <ProductSection variant="open" />
        <OtherInfoSection directory={false} />
        <AttachmentSection jobNo={job?.no} />
        {job?.no && <TrackLink jobNo={job.no} />}
        <JobHistorySection job={job} />

        <FormActions
          saveLabel="บันทึกการแก้ไข"
          onSave={save}
          saving={saving}
          onCancel={() => job && reset(fromJob(job))}
          extra={
            <PrintButton label="พิมพ์ใบรับงาน" kind="job" no={job?.no ?? ""} profileId={job?.documentProfileId} href={`/print/job/${encodeURIComponent(job?.no ?? "")}`} disabled={!job} />
          }
        />
      </RecordGate>
    </>
  );
}

export default function EditJobPage() {
  return (
    <JobFormProvider>
      <React.Suspense fallback={null}>
        <EditJobForm />
      </React.Suspense>
    </JobFormProvider>
  );
}
