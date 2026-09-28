"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { QuotationForm, type QuotationFormHandle, type QuotationLoaded } from "@/components/shared/quotation-form";
import { PrintButton } from "@/components/shared/print-button";
import { FormActions, JobLookupBar } from "@/components/shared/job-form";
import { RecordGate } from "@/components/shared/record-gate";
import { useToast } from "@/components/ui/toast";
import { api, postJson, errMsg } from "@/lib/api";
import { useRecord } from "@/lib/use-record";

const fetchQuotation = (no: string) =>
  api<{ quotation: QuotationLoaded }>(`/api/quotations/${encodeURIComponent(no)}`).then((d) => d.quotation);


function EditQuotation() {
  const { push } = useToast();
  const sp = useSearchParams();
  const initialNo = sp.get("no") ?? "";
  const form = React.useRef<QuotationFormHandle>(null);
  const { data: loaded, setData: setLoaded, loading, error, load: fetchRecord } = useRecord(fetchQuotation, !!initialNo);
  const no = loaded?.no ?? "";
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(
    async (v: string) => {
      const d = await fetchRecord(v);
      if (d) push({ kind: "success", title: "เรียกข้อมูลใบเสนอราคาสำเร็จ", desc: d.no });
      else if (d === null && v.trim()) push({ kind: "error", title: "ไม่พบใบเสนอราคา", desc: v.trim().toUpperCase() });
    },
    [fetchRecord, push]
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
    if (!form.current?.validate()) return;
    setSaving(true);
    try {
      const d = await postJson<{ quotation: QuotationLoaded }>("/api/quotations", { ...p, no });
      setLoaded(d.quotation);
      push({ kind: "success", title: "บันทึกการแก้ไขใบเสนอราคาแล้ว", desc: d.quotation.no });
    } catch (e) {
      if (!form.current?.fromApi(e)) push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
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
        id="quotation-no"
        label="ระบุ หมายเลขใบเสนอราคา"
        placeholder="Q2600462"
        initial={initialNo}
        onFind={(v) => load(v)}
      />
      <RecordGate ready={!!loaded} loading={loading} error={error} noun="ใบเสนอราคา" searchId="quotation-no">
        <QuotationForm ref={form} mode="edit" quotationNo={no || undefined} initial={loaded} />
        <FormActions
          saveLabel="บันทึกการแก้ไข"
          onSave={save}
          saving={saving}
          extra={
            <PrintButton label="พิมพ์ใบเสนอราคา" kind="quotation" no={no ?? ""} profileId={loaded?.documentProfileId} href={`/print/quotation/${encodeURIComponent(no ?? "")}`} disabled={!no} />
          }
        />
      </RecordGate>
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
