"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { SaleOrderForm, type SaleOrderFormHandle, type SaleOrderLoaded } from "@/components/shared/sale-order-form";
import { PrintButton } from "@/components/shared/print-button";
import { FormActions, JobLookupBar } from "@/components/shared/job-form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { api, postJson, errMsg } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

function EditSaleOrder() {
  const { push } = useToast();
  const confirm = useConfirm();
  const { isAdmin, can } = useAccess();
  const sp = useSearchParams();
  const initialNo = sp.get("no") ?? "";
  const form = React.useRef<SaleOrderFormHandle>(null);
  const [no, setNo] = React.useState("");
  const [loaded, setLoaded] = React.useState<SaleOrderLoaded | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(
    async (v: string) => {
      const q = v.trim().toUpperCase();
      if (!q) return;
      try {
        const d = await api<{ order: SaleOrderLoaded }>(`/api/sale-orders/${encodeURIComponent(q)}`);
        setLoaded(d.order);
        setNo(d.order.no);
        push({ kind: "success", title: "เรียกข้อมูลใบสั่งขายสำเร็จ", desc: d.order.no });
      } catch (e) {
        push({ kind: "error", title: "ไม่พบใบสั่งขาย", desc: errMsg(e) });
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
      push({ kind: "warning", title: "กรุณาระบุเลขใบสั่งขายก่อน" });
      return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ order: SaleOrderLoaded }>("/api/sale-orders", { ...p, no });
      setLoaded(d.order);
      push({ kind: "success", title: "บันทึกการแก้ไขใบสั่งขายแล้ว", desc: d.order.no });
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
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
        label="ระบุ เลขใบสั่งขาย (SO)"
        placeholder="SO2600760"
        initial={initialNo}
        onFind={(v) => load(v)}
        note={loaded ? `สถานะ: ${loaded.approve}` : undefined}
      />
      <SaleOrderForm ref={form} soNo={no || undefined} initial={loaded} />
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
