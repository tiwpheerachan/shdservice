"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import {
  CustomerSection,
  JobOpenSection,
  ProductSection,
  OtherInfoSection,
  AttachmentSection,
  FormActions,
  JobFormProvider,
  useJobForm,
  toJobInput,
  type AttachmentsHandle,
} from "@/components/shared/job-form";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TrackLink } from "@/components/shared/track-link";
import { postJson, errMsg } from "@/lib/api";
import type { JobDetail } from "@/lib/use-job";

function NewJobForm() {
  const { push } = useToast();
  const router = useRouter();
  const { s, reset } = useJobForm();
  const attach = React.useRef<AttachmentsHandle>(null);
  const [saving, setSaving] = React.useState(false);
  // after saving we stop here first so the tracking link can be copied and sent
  // to the customer right away (the job is trackable from the moment it exists)
  const [opened, setOpened] = React.useState<string | null>(null);

  // POST /api/jobs → job (running J), job_log(1), job_symptom, customer link
  const save = async () => {
    if (!s.customer) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องค้นหาและเลือกลูกค้าก่อน" });
      return;
    }
    if (!s.jobType) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องเลือกประเภทงานหลัก" });
      return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ job: JobDetail }>("/api/jobs", toJobInput(s));
      await attach.current?.uploadPending(d.job.no);
      push({ kind: "success", title: "เปิดงานใหม่เรียบร้อย", desc: `หมายเลขงาน ${d.job.no}` });
      reset();
      setOpened(d.job.no);
    } catch (e) {
      push({ kind: "error", title: "เปิดงานไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="เปิดงานใหม่"
        description="ข้อมูลงานบริการ » เปิดงานใหม่ — กรอกข้อมูลลูกค้า สินค้า และอาการเสีย"
      />
      <CustomerSection />
      <JobOpenSection status="งานใหม่" editable={false} />
      <ProductSection />
      <OtherInfoSection />
      <AttachmentSection ref={attach} />
      <FormActions saveLabel="บันทึกเปิดงาน" onSave={save} saving={saving} onCancel={() => reset()} />

      <Modal
        open={!!opened}
        onClose={() => setOpened(null)}
        title={`เปิดงานเรียบร้อย · ${opened ?? ""}`}
        description="ส่งลิงก์ติดตามให้ลูกค้าได้เลย หรือพิมพ์ใบรับงานก่อน"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => opened && window.open(`/print/job/${encodeURIComponent(opened)}`, "_blank")}
            >
              พิมพ์ใบรับงาน
            </Button>
            <Button size="sm" onClick={() => opened && router.push(`/jobs/repair?job=${encodeURIComponent(opened)}`)}>
              ไปบันทึกงานซ่อม
            </Button>
          </>
        }
      >
        {opened && <TrackLink jobNo={opened} compact />}
      </Modal>
    </>
  );
}

export default function NewJobPage() {
  return (
    <JobFormProvider>
      <NewJobForm />
    </JobFormProvider>
  );
}
