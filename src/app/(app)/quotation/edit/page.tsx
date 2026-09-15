"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { QuotationForm, type QuotationFormHandle, type QuotationLoaded } from "@/components/shared/quotation-form";
import { FormActions, JobLookupBar } from "@/components/shared/job-form";
import { useToast } from "@/components/ui/toast";
import { api, postJson, errMsg } from "@/lib/api";

function EditQuotation() {
  const { push } = useToast();
  const sp = useSearchParams();
  const initialNo = sp.get("no") ?? "";
  const form = React.useRef<QuotationFormHandle>(null);
  const [no, setNo] = React.useState("");
  const [loaded, setLoaded] = React.useState<QuotationLoaded | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(
    async (v: string) => {
      const q = v.trim().toUpperCase();
      if (!q) return;
      try {
        const d = await api<{ quotation: QuotationLoaded }>(`/api/quotations/${encodeURIComponent(q)}`);
        setLoaded(d.quotation);
        setNo(d.quotation.no);
        push({ kind: "success", title: "เรียกข้อมูลใบเสนอราคาสำเร็จ", desc: d.quotation.no });
      } catch (e) {
        push({ kind: "error", title: "ไม่พบใบเสนอราคา", desc: errMsg(e) });
      }
    },
    [push]
  );

  React.useEffect(() => {
    if (initialNo) void load(initialNo);
  }, [initialNo, load]);

  const save = async () => {
    const p = form.current?.payload();
    if (!p || !no) {
      push({ kind: "warning", title: "กรุณาระบุหมายเลขใบเสนอราคาก่อน" });
      return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ quotation: QuotationLoaded }>("/api/quotations", { ...p, no });
      setLoaded(d.quotation);
      push({ kind: "success", title: "บันทึกการแก้ไขใบเสนอราคาแล้ว", desc: d.quotation.no });
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="แก้ไขใบเสนอราคา"
        description="ระบุหมายเลขใบเสนอราคาเพื่อเรียกข้อมูลมาแก้ไข"
      />
      <JobLookupBar
        label="ระบุ หมายเลขใบเสนอราคา"
        placeholder="Q2600462"
        initial={initialNo}
        onFind={(v) => load(v)}
      />
      <QuotationForm ref={form} mode="edit" quotationNo={no || undefined} initial={loaded} />
      <FormActions saveLabel="บันทึกการแก้ไข" onSave={save} saving={saving} />
    </>
  );
}

export default function EditQuotationPage() {
  return (
    <React.Suspense fallback={null}>
      <EditQuotation />
    </React.Suspense>
  );
}
