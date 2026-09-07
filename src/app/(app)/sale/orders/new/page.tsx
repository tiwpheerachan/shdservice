"use client";

import { PageHeader } from "@/components/shared/page-header";
import { SaleOrderForm } from "@/components/shared/sale-order-form";
import { FormActions } from "@/components/shared/job-form";
import { useToast } from "@/components/ui/toast";

export default function NewSaleOrderPage() {
  const { push } = useToast();
  return (
    <>
      <PageHeader
        title="สร้างใบสั่งขาย"
        description="เมนูขาย » ใบสั่งขาย (Sale Order) — Mode: Add New Sale Order"
      />
      <SaleOrderForm />
      <FormActions
        saveLabel="บันทึกใบสั่งขาย"
        onSave={() =>
          push({ kind: "success", title: "สร้างใบสั่งขายแล้ว", desc: "SO2600728 (ระบบสาธิต)" })
        }
      />
    </>
  );
}
