"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { SaleOrderForm, type SaleOrderFormHandle } from "@/components/shared/sale-order-form";
import { FormActions } from "@/components/shared/job-form";
import { useToast } from "@/components/ui/toast";
import { postJson, errMsg } from "@/lib/api";

export default function NewSaleOrderPage() {
  const { push } = useToast();
  const router = useRouter();
  const form = React.useRef<SaleOrderFormHandle>(null);
  const [saving, setSaving] = React.useState(false);

  // POST /api/sale-orders → sale_out_hd (running SO) + sale_out_dt; approve status 1 or 2
  const save = async () => {
    const p = form.current?.payload();
    if (!p) return;
    if (!p.customerCode) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องระบุลูกค้า" });
      return;
    }
    if (!p.lines.length) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ" });
      return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ order: { no: string } }>("/api/sale-orders", p);
      push({ kind: "success", title: "สร้างใบสั่งขายแล้ว", desc: d.order.no });
      router.push(`/sale/orders/edit?no=${encodeURIComponent(d.order.no)}`);
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="สร้างใบสั่งขาย"
        description="เมนูขาย » ใบสั่งขาย (Sale Order) — Mode: Add New Sale Order"
      />
      <SaleOrderForm ref={form} />
      <FormActions saveLabel="บันทึกใบสั่งขาย" onSave={save} saving={saving} />
    </>
  );
}
