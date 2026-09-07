"use client";

import * as React from "react";
import { PageHeader } from "@/components/shared/page-header";
import { SaleOrderForm } from "@/components/shared/sale-order-form";
import { FormActions, JobLookupBar } from "@/components/shared/job-form";
import { useToast } from "@/components/ui/toast";

export default function EditSaleOrderPage() {
  const { push } = useToast();
  const [no, setNo] = React.useState("");

  return (
    <>
      <PageHeader
        title="แก้ไขใบสั่งขาย"
        description="เมนูขาย » ใบสั่งขาย (Sale Order) — Mode: Edit"
      />
      <JobLookupBar
        label="ระบุ เลขใบสั่งขาย (SO)"
        placeholder="SO2600727"
        onFind={(v) => {
          setNo(v || "SO2600727");
          push({ kind: "success", title: "เรียกข้อมูลใบสั่งขายสำเร็จ", desc: v || "SO2600727" });
        }}
      />
      <SaleOrderForm soNo={no || undefined} />
      <FormActions
        saveLabel="บันทึกการแก้ไข"
        onSave={() => push({ kind: "success", title: "บันทึกการแก้ไขใบสั่งขายแล้ว" })}
      />
    </>
  );
}
