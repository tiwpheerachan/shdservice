"use client";

import * as React from "react";
import { PageHeader } from "@/components/shared/page-header";
import { QuotationForm } from "@/components/shared/quotation-form";
import { FormActions, JobLookupBar } from "@/components/shared/job-form";
import { useToast } from "@/components/ui/toast";

export default function EditQuotationPage() {
  const { push } = useToast();
  const [no, setNo] = React.useState("");

  return (
    <>
      <PageHeader
        title="แก้ไขใบเสนอราคา"
        description="ระบุหมายเลขใบเสนอราคาเพื่อเรียกข้อมูลมาแก้ไข"
      />
      <JobLookupBar
        label="ระบุ หมายเลขใบเสนอราคา"
        placeholder="QT2601200"
        onFind={(v) => {
          setNo(v || "QT2601200");
          push({ kind: "success", title: "เรียกข้อมูลใบเสนอราคาสำเร็จ", desc: v || "QT2601200" });
        }}
      />
      <QuotationForm mode="edit" quotationNo={no || undefined} />
      <FormActions
        saveLabel="บันทึกการแก้ไข"
        onSave={() => push({ kind: "success", title: "บันทึกการแก้ไขใบเสนอราคาแล้ว" })}
      />
    </>
  );
}
