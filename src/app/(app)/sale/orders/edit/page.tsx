"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { SaleOrderForm, type SaleOrderFormHandle, type SaleOrderLoaded } from "@/components/shared/sale-order-form";
import { PrintButton } from "@/components/shared/print-button";
import { FormActions, JobLookupBar } from "@/components/shared/job-form";
import { Button } from "@/components/ui/button";
import { RecordGate } from "@/components/shared/record-gate";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { postJson, errMsg } from "@/lib/api";
import { useRecord } from "@/lib/use-record";
import { useAccess } from "@/lib/use-access";


function EditSaleOrder() {
  const { push } = useToast();
  const confirm = useConfirm();
  const { isAdmin, can } = useAccess();
  const sp = useSearchParams();
  const initialNo = sp.get("no") ?? "";
  const form = React.useRef<SaleOrderFormHandle>(null);
  // every record that arrives (loaded or saved) remounts the form with it — the form reads `initial`
  // once, when it mounts, so a new record always starts from a clean form
  const [version, setVersion] = React.useState(0);
  // the number from ?no= opens quietly; the lookup bar's number toasts found / not found
  const { data: loaded, setData: setLoaded, loading, error, find: load } = useRecord<SaleOrderLoaded>({
    url: (n) => `/api/sale-orders/${encodeURIComponent(n)}`,
    pick: (d: { order: SaleOrderLoaded }) => d.order,
    initial: initialNo,
    onRecord: () => setVersion((v) => v + 1),
    onLoaded: (d) => push({ kind: "success", title: "เรียกข้อมูลใบสั่งขายสำเร็จ", desc: d.no }),
    onMissing: (n) => push({ kind: "error", title: "ไม่พบใบสั่งขาย", desc: n }),
  });
  const no = loaded?.no ?? "";
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    const p = form.current?.payload();
    if (!p || !no) return; // the save bar only shows once the document is loaded (RecordGate)
    if (!form.current?.validate()) return;
    setSaving(true);
    try {
      const d = await postJson<{ order: SaleOrderLoaded }>("/api/sale-orders", { ...p, no });
      setLoaded(d.order);
      push({ kind: "success", title: "บันทึกการแก้ไขใบสั่งขายแล้ว", desc: d.order.no });
    } catch (e) {
      if (!form.current?.fromApi(e)) push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  // อนุมัติ → ตัดสต๊อก (WHO type 4) ทันที ตามพฤติกรรมระบบเดิม
  const decide = async (decision: "approve" | "deny" | "reject") => {
    if (!no) return;
    const label = decision === "approve" ? "อนุมัติ" : decision === "deny" ? "ปฏิเสธ" : "ส่งกลับแก้ไข";
    const ok = await confirm({
      tone: decision === "approve" ? "default" : "danger",
      title: `${label}ใบสั่งขาย ${no}?`,
      description:
        decision === "approve"
          ? "ระบบจะตัดสต๊อกตามรายการในใบทันที (สร้างเอกสารจ่ายออก WHO) และแก้ไขรายการไม่ได้อีก"
          : decision === "deny"
            ? "ใบนี้จะถูกปฏิเสธ ไม่ตัดสต๊อก และไม่สามารถอนุมัติภายหลังได้"
            : "ใบจะถูกส่งกลับให้ผู้สร้างแก้ไข แล้วบันทึกใหม่เพื่อขออนุมัติอีกครั้ง",
      confirmLabel: decision === "approve" ? "อนุมัติ (ตัดสต๊อก)" : label,
    });
    if (!ok) return;
    setSaving(true);
    try {
      const d = await postJson<{ order: SaleOrderLoaded }>(`/api/sale-orders/${encodeURIComponent(no)}/approve`, { decision });
      setLoaded(d.order);
      push({ kind: "success", title: `${label}แล้ว`, desc: `${d.order.no} · ${d.order.approve}` });
    } catch (e) {
      push({ kind: "error", title: `${label}ไม่สำเร็จ`, desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const approved = (loaded?.approveId ?? 0) === 4;
  const canApprove = isAdmin || can("Sale Order", "edit");

  return (
    <>
      <PageHeader
        title="แก้ไขใบสั่งขาย"
        description="เมนูขาย » ใบสั่งขาย (Sale Order) — Mode: Edit"
      />
      <JobLookupBar
        id="so-no"
        label="ระบุ เลขใบสั่งขาย (SO)"
        placeholder="SO2600760"
        initial={initialNo}
        onFind={(v) => load(v)}
        note={loaded ? `สถานะ: ${loaded.approve}` : undefined}
      />
      <RecordGate ready={!!loaded} loading={loading} error={error} noun="ใบสั่งขาย" searchId="so-no">
        <SaleOrderForm key={version} ref={form} soNo={no || undefined} initial={loaded} />
        <FormActions
          saveLabel="บันทึกการแก้ไข"
          onSave={save}
          saving={saving || approved}
          extra={
            <>
              <PrintButton label="พิมพ์ใบสั่งขาย" kind="sale_order" no={no ?? ""} profileId={loaded?.documentProfileId} href={`/print/sale-order/${encodeURIComponent(no ?? "")}`} disabled={!no} />
              {loaded && !approved && canApprove ? (
              <>
                <Button variant="outline" size="md" type="button" onClick={() => decide("reject")} disabled={saving}>
                  ส่งกลับแก้ไข
                </Button>
                <Button variant="outline" size="md" type="button" onClick={() => decide("deny")} disabled={saving}>
                  ปฏิเสธ
                </Button>
                <Button size="md" type="button" onClick={() => decide("approve")} disabled={saving}>
                  อนุมัติ (ตัดสต๊อก)
                </Button>
              </>
              ) : null}
            </>
          }
        />
      </RecordGate>
    </>
  );
}

export default function EditSaleOrderPage() {
  return (
    <React.Suspense fallback={null}>
      <EditSaleOrder />
    </React.Suspense>
  );
}
