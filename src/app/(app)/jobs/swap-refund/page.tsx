"use client";

import * as React from "react";
import { RefreshCcw, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { JobSearch } from "@/components/shared/job-search";
import { Section } from "@/components/shared/section";
import {
  CustomerSection,
  ProductSection,
  CostSummary,
  AttachmentSection,
  FormActions,
  JobFormProvider,
  useJobForm,
  fromJob,
  saveCommonSections,
} from "@/components/shared/job-form";
import { useAccess } from "@/lib/use-access";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { JOB_STATUS_OPTIONS } from "@/data/mock";
import { useJob, type JobDetail } from "@/lib/use-job";
import { postJson, errMsg } from "@/lib/api";

// parse the "key: value" lines this app writes into job.swap_refund_detail
function parseSwap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function SwapRefundForm() {
  const { push } = useToast();
  const { jobNo, job, find, setJob } = useJob();
  const { s: form, reset } = useJobForm();
  const { can } = useAccess();
  const [tab, setTab] = React.useState("product");
  const [mode, setMode] = React.useState("swap");
  const [saving, setSaving] = React.useState(false);
  const [d, setD] = React.useState({
    inspection: "",
    newSerial: "",
    newModel: "",
    swapDate: "",
    docNo: "",
    refundAmount: "",
    refundMethod: "โอนเงินเข้าบัญชี",
    refundRef: "",
    refundDate: "",
    detail: "",
    status: "",
  });
  const upd = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));

  React.useEffect(() => {
    if (!job) return;
    reset(fromJob(job));
    const sw = parseSwap(job.swap.detail);
    const today = new Date().toISOString().slice(0, 10);
    const refund = !!sw["ยอดเงินคืน"] || job.payment.amount < 0;
    setMode(refund ? "refund" : "swap");
    upd({
      inspection: job.repairDetail,
      newSerial: (sw["New S/N"] ?? "").trim(),
      newModel: sw["รุ่นที่เปลี่ยนให้"] ?? "",
      swapDate: sw["วันที่เปลี่ยนเครื่อง"] || today,
      docNo: job.swap.docNo,
      refundAmount: sw["ยอดเงินคืน"] ?? (job.payment.amount < 0 ? String(Math.abs(job.payment.amount)) : ""),
      refundMethod: sw["วิธีการคืนเงิน"] || "โอนเงินเข้าบัญชี",
      refundRef: sw["เลขที่บัญชี/อ้างอิง"] ?? "",
      refundDate: sw["วันที่คืนเงิน"] || today,
      detail: sw["รายละเอียด"] ?? (job.swap.detail && Object.keys(sw).length === 0 ? job.swap.detail : ""),
      status: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const go = async (v: string) => {
    if (!v) return;
    const j = await find(v);
    if (j) push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: j.no });
    else push({ kind: "error", title: "ไม่พบหมายเลขงาน", desc: v });
  };

  // POST /api/jobs/:no/swap-refund → swap_refund_detail / document_no / payment (refund) + status + job_log
  const save = async () => {
    if (!job) {
      push({ kind: "warning", title: "กรุณาระบุหมายเลขงานก่อน" });
      return;
    }
    setSaving(true);
    try {
      await saveCommonSections(job.no, form, can("Job Management", "edit"));
      const body =
        mode === "swap"
          ? { inspection: d.inspection, newSerial: d.newSerial, newModel: d.newModel, swapDate: d.swapDate, docNo: d.docNo, detail: d.detail, status: d.status || undefined }
          : { inspection: d.inspection, refundAmount: d.refundAmount, refundMethod: d.refundMethod, refundRef: d.refundRef, refundDate: d.refundDate, docNo: d.docNo, detail: d.detail, status: d.status || undefined };
      const r = await postJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(job.no)}/swap-refund`, body);
      setJob(r.job);
      push({ kind: "success", title: mode === "swap" ? "บันทึกการเปลี่ยนเครื่องแล้ว" : "บันทึกการคืนเงินแล้ว", desc: `${r.job.no} · ${r.job.status}` });
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="บันทึกงาน Swap / Refund"
        description="ข้อมูลงานบริการ » บันทึกข้อมูล (Swap / Refund)"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="swap-job-no" className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              ระบุ หมายเลขงาน
            </label>
            <JobSearch id="swap-job-no" value={jobNo} scope="open" onPick={go} />
          </div>
        }
      />

      <CustomerSection readOnly />

      <Section title="ข้อมูลการเปิดงาน" icon={ClipboardList}>
        <FieldGrid>
          <Field label="หมายเลขงาน">
            <ReadOnly><span className="num">{job?.no ?? "—"}</span></ReadOnly>
          </Field>
          <Field label="วันที่เปิดงาน">
            <ReadOnly><span className="num">{job ? `${job.createDate} น.` : "—"}</span></ReadOnly>
          </Field>
          <Field label="เปิดงานโดย">
            <ReadOnly>{job?.createByName || "—"}</ReadOnly>
          </Field>
          <Field label="สถานะงาน (ปัจจุบัน)">
            <ReadOnly>
              <Badge tone="warning" dot>{job?.status ?? "—"}</Badge>
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
              <Textarea rows={2} readOnly value={form.symptoms.join(", ")} />
            </Field>
            <Field label="ผลการตรวจสอบ" className="lg:col-span-2">
              <Textarea rows={2} value={d.inspection} onChange={(e) => upd({ inspection: e.target.value })} />
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
                <Input className="num" value={d.newSerial} onChange={(e) => upd({ newSerial: e.target.value })} />
              </Field>
              <Field label="รุ่นที่เปลี่ยนให้">
                <Input value={d.newModel} onChange={(e) => upd({ newModel: e.target.value })} />
              </Field>
              <Field label="วันที่เปลี่ยนเครื่อง">
                <Input type="date" value={d.swapDate} onChange={(e) => upd({ swapDate: e.target.value })} />
              </Field>
              <Field label="เลขที่เอกสารเบิกสินค้า">
                <Input className="num" value={d.docNo} onChange={(e) => upd({ docNo: e.target.value })} />
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
                  value={d.refundAmount}
                  onChange={(e) => upd({ refundAmount: e.target.value })}
                  onFocus={(e) => e.currentTarget.select()}
                  className="num text-right"
                />
              </Field>
              <Field label="วิธีการคืนเงิน" required>
                <Select value={d.refundMethod} onChange={(e) => upd({ refundMethod: e.target.value })}>
                  <option>โอนเงินเข้าบัญชี</option>
                  <option>เงินสด</option>
                  <option>คืนผ่านช่องทางการขาย</option>
                </Select>
              </Field>
              <Field label="เลขที่บัญชี / อ้างอิง">
                <Input className="num" value={d.refundRef} onChange={(e) => upd({ refundRef: e.target.value })} />
              </Field>
              <Field label="วันที่คืนเงิน">
                <Input type="date" value={d.refundDate} onChange={(e) => upd({ refundDate: e.target.value })} />
              </Field>
            </>
          )}
          <Field label="รายละเอียด" wide>
            <Textarea rows={3} value={d.detail} onChange={(e) => upd({ detail: e.target.value })} />
          </Field>
          <Field label="โปรดระบุ สถานะงาน" required wide>
            <Select value={d.status} onChange={(e) => upd({ status: e.target.value })}>
              <option value="">- - Please Select - -</option>
              {JOB_STATUS_OPTIONS.map((st) => (
                <option key={st}>{st}</option>
              ))}
            </Select>
          </Field>
        </FieldGrid>
      </Section>

      <CostSummary />
      <AttachmentSection jobNo={job?.no} />

      <FormActions saveLabel="บันทึกข้อมูล" onSave={save} saving={saving} onCancel={() => job && reset(fromJob(job))} />
    </>
  );
}

export default function SwapRefundPage() {
  return (
    <JobFormProvider>
      <React.Suspense fallback={null}>
        <SwapRefundForm />
      </React.Suspense>
    </JobFormProvider>
  );
}
