"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { SaleOrderForm, type SaleOrderFormHandle, type SaleOrderLoaded } from "@/components/shared/sale-order-form";
import { FormActions, JobLookupBar } from "@/components/shared/job-form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, postJson, errMsg } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

function EditSaleOrder() {
  const { push } = useToast();
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
    if (!window.confirm(`${label}ใบสั่งขาย ${no}?`)) return;
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
            <Button variant="outline" size="md" type="button" disabled={!no} onClick={() => no && window.open(`/print/sale-order/${encodeURIComponent(no)}`, "_blank")}>
              พิมพ์ใบสั่งขาย
            </Button>
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
