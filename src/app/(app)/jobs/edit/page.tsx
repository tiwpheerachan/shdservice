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
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useJob, type JobDetail } from "@/lib/use-job";
import { patchJson, errMsg } from "@/lib/api";

function EditJobForm() {
  const { push } = useToast();
  const { jobNo, job, find, setJob } = useJob();
  const { s, reset } = useJobForm();
  const [saving, setSaving] = React.useState(false);

  // prefill the form whenever a job is loaded (from ?job= or the GO button)
  React.useEffect(() => {
    if (job) reset(fromJob(job));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const go = async (v: string) => {
    if (!v) return;
    const j = await find(v);
    if (j) push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: j.no });
    else push({ kind: "error", title: "ไม่พบหมายเลขงาน", desc: v });
  };

  // PATCH /api/jobs/:no — updates the job row (+ job_log if the status changed)
  const save = async () => {
    if (!job) {
      push({ kind: "warning", title: "กรุณาระบุหมายเลขงานก่อน" });
      return;
    }
    setSaving(true);
    try {
      const d = await patchJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(job.no)}`, toJobInput(s));
      setJob(d.job);
      push({ kind: "success", title: "บันทึกการแก้ไขงานแล้ว", desc: d.job.no });
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
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

      <CustomerSection />
      <JobOpenSection jobNo={job?.no} status={job?.status ?? "อยู่ระหว่างดำเนินการ"} />
      <ProductSection />
      <OtherInfoSection />
      <AttachmentSection jobNo={job?.no} />
      <JobHistorySection job={job} />

      <FormActions
        saveLabel="บันทึกการแก้ไข"
        onSave={save}
        saving={saving}
        onCancel={() => job && reset(fromJob(job))}
        extra={
          <Button variant="outline" size="md" type="button" disabled={!job} onClick={() => job && window.open(`/print/job/${encodeURIComponent(job.no)}`, "_blank")}>
            พิมพ์ใบรับงาน
          </Button>
        }
      />
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
