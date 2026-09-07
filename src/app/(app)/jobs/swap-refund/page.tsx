"use client";

import * as React from "react";
import { RefreshCcw, ClipboardList, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Section } from "@/components/shared/section";
import {
  CustomerSection,
  ProductSection,
  CostSummary,
  AttachmentSection,
  FormActions,
} from "@/components/shared/job-form";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { JOB_STATUS_OPTIONS } from "@/data/mock";

export default function SwapRefundPage() {
  const { push } = useToast();
  const [tab, setTab] = React.useState("product");
  const [mode, setMode] = React.useState("swap");
  const [q, setQ] = React.useState("");

  const go = () => {
    const v = q.trim() || "JOB2604460";
    push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: v });
  };

  return (
    <>
      <PageHeader
        title="บันทึกงาน Swap / Refund"
        description="ข้อมูลงานบริการ » บันทึกข้อมูล (Swap / Refund)"
        actions={
          <div className="flex items-center gap-2">
            <label
              htmlFor="swap-job-no"
              className="whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              ระบุ หมายเลขงาน
            </label>
            <div className="relative">
              <Input
                id="swap-job-no"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && go()}
                placeholder="JOB2604460"
                className="num h-9 w-44 pr-8"
              />
              <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
            <Button size="md" onClick={go}>
              GO
            </Button>
          </div>
        }
      />

      <CustomerSection readOnly />

      <Section title="ข้อมูลการเปิดงาน" icon={ClipboardList}>
        <FieldGrid>
          <Field label="หมายเลขงาน">
            <ReadOnly><span className="num">JOB2604460</span></ReadOnly>
          </Field>
          <Field label="วันที่เปิดงาน">
            <ReadOnly><span className="num">2026-09-04 09:12 น.</span></ReadOnly>
          </Field>
          <Field label="เปิดงานโดย">
            <ReadOnly>Kanokwan S.</ReadOnly>
          </Field>
          <Field label="สถานะงาน (ปัจจุบัน)">
            <ReadOnly>
              <Badge tone="warning" dot>อยู่ระหว่างดำเนินการ</Badge>
            </ReadOnly>
          </Field>
        </FieldGrid>
      </Section>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "product", label: "ข้อมูลสินค้า" },
          { key: "detail", label: "รายละเอียดการซ่อม" },
        ]}
      />

      {tab === "product" ? (
        <ProductSection title="ข้อมูลสินค้า" />
      ) : (
        <Section title="รายละเอียดการซ่อม" icon={ClipboardList}>
          <FieldGrid>
            <Field label="อาการเสียหลัก (มาตรฐาน)" className="lg:col-span-2">
              <Textarea rows={2} readOnly value="เปิดเครื่องไม่ติด" />
            </Field>
            <Field label="ผลการตรวจสอบ" className="lg:col-span-2">
              <Textarea rows={2} />
            </Field>
          </FieldGrid>
        </Section>
      )}

      <Section title="ข้อมูลการดำเนินงาน" icon={RefreshCcw}>
        <div className="mb-4 flex gap-2">
          {[
            { k: "swap", l: "Swap — เปลี่ยนเครื่องใหม่" },
            { k: "refund", l: "Refund — คืนเงิน" },
          ].map((o) => (
            <button
              key={o.k}
              onClick={() => setMode(o.k)}
              className={
                "flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors " +
                (mode === o.k
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-input")
              }
            >
              {o.l}
            </button>
          ))}
        </div>

        <FieldGrid>
          {mode === "swap" ? (
            <>
              <Field label="New Serial No." required>
                <Input className="num" />
              </Field>
              <Field label="รุ่นที่เปลี่ยนให้">
                <Input />
              </Field>
              <Field label="วันที่เปลี่ยนเครื่อง">
                <Input type="date" defaultValue="2026-09-04" />
              </Field>
              <Field label="เลขที่เอกสารเบิกสินค้า">
                <Input className="num" />
              </Field>
            </>
          ) : (
            <>
              <Field label="ยอดเงินคืน (บาท)" required>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  inputMode="decimal"
                  placeholder="0.00"
                  onFocus={(e) => e.currentTarget.select()}
                  className="num text-right"
                />
              </Field>
              <Field label="วิธีการคืนเงิน" required>
                <Select>
                  <option>โอนเงินเข้าบัญชี</option>
                  <option>เงินสด</option>
                  <option>คืนผ่านช่องทางการขาย</option>
                </Select>
              </Field>
              <Field label="เลขที่บัญชี / อ้างอิง">
                <Input className="num" />
              </Field>
              <Field label="วันที่คืนเงิน">
                <Input type="date" defaultValue="2026-09-04" />
              </Field>
            </>
          )}
          <Field label="รายละเอียด" wide>
            <Textarea rows={3} />
          </Field>
          <Field label="โปรดระบุ สถานะงาน" required wide>
            <Select defaultValue="">
              <option value="">- - Please Select - -</option>
              {JOB_STATUS_OPTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </FieldGrid>
      </Section>

      <CostSummary />
      <AttachmentSection />

      <FormActions
        saveLabel="บันทึกข้อมูล"
        onSave={() =>
          push({
            kind: "success",
            title: mode === "swap" ? "บันทึกการเปลี่ยนเครื่องแล้ว" : "บันทึกการคืนเงินแล้ว",
          })
        }
      />
    </>
  );
}
