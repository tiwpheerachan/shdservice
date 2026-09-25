"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { QuotationForm, type QuotationFormHandle } from "@/components/shared/quotation-form";
import { FormActions } from "@/components/shared/job-form";
import { useToast } from "@/components/ui/toast";
import { postJson, errMsg } from "@/lib/api";

function NewQuotation() {
  const { push } = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const form = React.useRef<QuotationFormHandle>(null);
  const [saving, setSaving] = React.useState(false);

  // POST /api/quotations → quotation_hd (running Q) + quotation_dt
  const save = async () => {
    const p = form.current?.payload();
    if (!p) return;
    if (!p.customerCode) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องระบุลูกค้า" });
      return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ quotation: { no: string } }>("/api/quotations", p);
      push({ kind: "success", title: "สร้างใบเสนอราคาแล้ว", desc: d.quotation.no });
      router.push(`/quotation/edit?no=${encodeURIComponent(d.quotation.no)}`);
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="สร้างใบเสนอราคา"
        description="ข้อมูลการเสนอราคา » เสนอราคางานซ่อม"
      />
      <QuotationForm ref={form} mode="new" jobNo={sp.get("job") ?? undefined} />
      <FormActions saveLabel="บันทึกใบเสนอราคา" onSave={save} saving={saving} />
    </>
  );
}

export default function NewQuotationPage() {
  return (
    <React.Suspense fallback={null}>
      <NewQuotation />
    </React.Suspense>
  );
}
