"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import {
  CustomerSection,
  JobOpenSection,
  ProductSection,
  OtherInfoSection,
  AttachmentSection,
  FormActions,
} from "@/components/shared/job-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export default function EditJobPage() {
  const { push } = useToast();
  const [q, setQ] = React.useState("");
  const [jobNo, setJobNo] = React.useState<string>("");

  const go = () => {
    const v = q.trim() || "JOB2604460";
    setJobNo(v);
    push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: v });
  };

  return (
    <>
      <PageHeader
        title="แก้ไขข้อมูลงาน"
        description="ข้อมูลงานบริการ » แก้ไขข้อมูลงาน — ระบุหมายเลขงานเพื่อเรียกข้อมูลมาแก้ไข"
        actions={
          <div className="flex items-center gap-2">
            <label
              htmlFor="edit-job-no"
              className="whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              ระบุ หมายเลขงาน
            </label>
            <div className="relative">
              <Input
                id="edit-job-no"
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

      <CustomerSection />
      <JobOpenSection jobNo={jobNo || undefined} status="อยู่ระหว่างดำเนินการ" />
      <ProductSection />
      <OtherInfoSection />
      <AttachmentSection />

      <FormActions
        saveLabel="บันทึกการแก้ไข"
        onSave={() => push({ kind: "success", title: "บันทึกการแก้ไขงานแล้ว" })}
      />
    </>
  );
}
