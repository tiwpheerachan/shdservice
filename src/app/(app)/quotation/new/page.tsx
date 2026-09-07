"use client";

import { PageHeader } from "@/components/shared/page-header";
import { QuotationForm } from "@/components/shared/quotation-form";
import { FormActions } from "@/components/shared/job-form";
import { useToast } from "@/components/ui/toast";

export default function NewQuotationPage() {
  const { push } = useToast();
  return (
    <>
      <PageHeader
        title="สร้างใบเสนอราคา"
        description="ข้อมูลการเสนอราคา » เสนอราคางานซ่อม"
      />
      <QuotationForm mode="new" />
      <FormActions
        saveLabel="บันทึกใบเสนอราคา"
        onSave={() =>
          push({ kind: "success", title: "สร้างใบเสนอราคาแล้ว", desc: "QT2601222 (ระบบสาธิต)" })
        }
      />
    </>
  );
}
