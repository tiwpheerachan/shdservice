"use client";

import { PageHeader } from "@/components/shared/page-header";
import {
  CustomerSection,
  JobOpenSection,
  ProductSection,
  OtherInfoSection,
  AttachmentSection,
  FormActions,
} from "@/components/shared/job-form";
import { useToast } from "@/components/ui/toast";

export default function NewJobPage() {
  const { push } = useToast();
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
      <AttachmentSection />
      <FormActions
        saveLabel="บันทึกเปิดงาน"
        onSave={() =>
          push({
            kind: "success",
            title: "เปิดงานใหม่เรียบร้อย",
            desc: "หมายเลขงาน JOB2604461 (ระบบสาธิต)",
          })
        }
      />
    </>
  );
}
