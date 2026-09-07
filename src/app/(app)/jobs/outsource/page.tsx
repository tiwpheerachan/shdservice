"use client";

import * as React from "react";
import { Truck, PackageCheck, ClipboardList, Search } from "lucide-react";
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
import { OUTSOURCE_VENDORS, TECHNICIANS, JOB_STATUS_OPTIONS } from "@/data/mock";

export default function OutsourcePage() {
  const { push } = useToast();
  const [tab, setTab] = React.useState("device");
  const [q, setQ] = React.useState("");

  const go = () => {
    const v = q.trim() || "JOB2604460";
    push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: v });
  };

  return (
    <>
      <PageHeader
        title="บันทึกงานส่งซ่อมต่อ (Out-Source)"
        description="ข้อมูลงานซ่อม » บันทึกข้อมูลส่งซ่อม Out-Source"
        actions={
          <div className="flex items-center gap-2">
            <label
              htmlFor="outsource-job-no"
              className="whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              ระบุ หมายเลขงานซ่อม
            </label>
            <div className="relative">
              <Input
                id="outsource-job-no"
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

      <Section title="ข้อมูลการเปิดงานซ่อม" icon={ClipboardList}>
        <FieldGrid>
          <Field label="หมายเลขงานซ่อม">
            <ReadOnly><span className="num">JOB2604460</span></ReadOnly>
          </Field>
          <Field label="วันที่เปิดงานซ่อม">
            <ReadOnly><span className="num">2026-09-04 09:12 น.</span></ReadOnly>
          </Field>
          <Field label="เปิดงานซ่อมโดย">
            <ReadOnly>Kanokwan S.</ReadOnly>
          </Field>
          <Field label="สถานะงานซ่อม (ปัจจุบัน)">
            <ReadOnly>
              <Badge tone="info" dot>ส่งซ่อม Out-Source</Badge>
            </ReadOnly>
          </Field>
        </FieldGrid>
      </Section>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "device", label: "ข้อมูลเครื่องซ่อม" },
          { key: "detail", label: "รายละเอียดการซ่อม" },
        ]}
      />

      {tab === "device" ? (
        <ProductSection title="ข้อมูลเครื่องซ่อม" />
      ) : (
        <Section title="รายละเอียดการซ่อม" icon={ClipboardList}>
          <FieldGrid>
            <Field label="อาการเสีย (มาตรฐาน)" className="lg:col-span-2">
              <Textarea rows={2} readOnly value="เปิดเครื่องไม่ติด, รีโมทไม่ทำงาน" />
            </Field>
            <Field label="อาการเสีย (อื่นๆ)" className="lg:col-span-2">
              <Textarea rows={2} />
            </Field>
            <Field label="วิธีการซ่อมเบื้องต้น" wide>
              <Textarea rows={3} />
            </Field>
          </FieldGrid>
        </Section>
      )}

      <Section title="รายละเอียด การส่งงานซ่อม" icon={Truck}>
        <FieldGrid>
          <Field label="ส่งไปยัง" required className="lg:col-span-2">
            <Select defaultValue="">
              <option value="">- - Please Select - -</option>
              {OUTSOURCE_VENDORS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="วันที่ส่ง" required>
            <Input type="date" defaultValue="2026-09-04" />
          </Field>
          <Field label="ส่งโดย" required>
            <Select>
              {TECHNICIANS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="หมายเหตุการส่ง" wide>
            <Textarea rows={2} />
          </Field>
        </FieldGrid>
      </Section>

      <Section title="รายละเอียด การรับคืนงานซ่อม" icon={PackageCheck}>
        <FieldGrid>
          <Field label="รับจาก" className="lg:col-span-2">
            <Select defaultValue="">
              <option value="">- - Please Select - -</option>
              {OUTSOURCE_VENDORS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="วันที่รับ">
            <Input type="date" />
          </Field>
          <Field label="รับโดย">
            <Select>
              {TECHNICIANS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="หมายเหตุการรับคืน" wide>
            <Textarea rows={2} />
          </Field>
          <Field label="โปรดระบุ สถานะงานซ่อม" required wide>
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
        saveLabel="บันทึกข้อมูล Out-Source"
        onSave={() => push({ kind: "success", title: "บันทึกข้อมูลส่งซ่อมต่อแล้ว" })}
      />
    </>
  );
}
