"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { QuotationForm, type QuotationFormHandle, type QuotationLoaded } from "@/components/shared/quotation-form";
import { PrintButton } from "@/components/shared/print-button";
import { FormActions, JobLookupBar } from "@/components/shared/job-form";
import { RecordGate } from "@/components/shared/record-gate";
import { useToast } from "@/components/ui/toast";
import { postJson, errMsg } from "@/lib/api";
import { useRecord } from "@/lib/use-record";


function EditQuotation() {
  const { push } = useToast();
  const sp = useSearchParams();
  const initialNo = sp.get("no") ?? "";
  const form = React.useRef<QuotationFormHandle>(null);
  // every record that arrives (loaded or saved) remounts the form with it — the form reads `initial`
  // once, when it mounts, so a new record always starts from a clean form
  const [version, setVersion] = React.useState(0);
  // the number from ?no= opens quietly; the lookup bar's number toasts found / not found
  const { data: loaded, setData: setLoaded, loading, error, find: load } = useRecord<QuotationLoaded>({
    url: (n) => `/api/quotations/${encodeURIComponent(n)}`,
    pick: (d: { quotation: QuotationLoaded }) => d.quotation,
    initial: initialNo,
    onRecord: () => setVersion((v) => v + 1),
    onLoaded: (d) => push({ kind: "success", title: "เรียกข้อมูลใบเสนอราคาสำเร็จ", desc: d.no }),
    onMissing: (n) => push({ kind: "error", title: "ไม่พบใบเสนอราคา", desc: n }),
  });
  const no = loaded?.no ?? "";
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    const p = form.current?.payload();
    if (!p || !no) return; // the save bar only shows once the document is loaded (RecordGate)
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
        <QuotationForm key={version} ref={form} mode="edit" quotationNo={no || undefined} initial={loaded} />
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
