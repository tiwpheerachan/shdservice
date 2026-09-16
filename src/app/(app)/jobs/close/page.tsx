"use client";

import * as React from "react";
import { PackageCheck, ClipboardList, Wallet, Printer, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Section } from "@/components/shared/section";
import {
  CustomerSection,
  ProductSection,
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
import { RETURN_METHODS, COURIERS, PAYMENT_METHODS, CLOSE_STATUS_OPTIONS } from "@/data/mock";
import { baht } from "@/lib/utils";
import { useJob, type JobDetail } from "@/lib/use-job";
import { postJson, errMsg, uploadFile, fileUrl } from "@/lib/api";

function CloseForm() {
  const { push } = useToast();
  const { jobNo, job, find, setJob } = useJob();
  const { s: form, reset } = useJobForm();
  const { can } = useAccess();
  const [tab, setTab] = React.useState("product");
  const [q, setQ] = React.useState(jobNo);
  const [saving, setSaving] = React.useState(false);
  const [d, setD] = React.useState({
    payType: PAYMENT_METHODS[0],
    payAmount: "",
    payDate: "",
    payNo: "",
    payDetail: "",
    returnType: "",
    returnDate: "",
    courier: "",
    tracking: "",
    returnDetail: "",
    status: "",
  });
  const upd = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const [slip, setSlip] = React.useState("");
  // สลิปชำระเงิน → bucket oneservice/jobs/{no}/slip/… (path เก็บใน job.job_payment_slip_file_name)
  const onPickSlip = async (f: File | undefined) => {
    if (!f || !job) return;
    try {
      const r = await uploadFile("job-slip", job.no, f);
      setSlip(r.path);
      push({ kind: "success", title: "อัปโหลดสลิปแล้ว", desc: f.name });
    } catch (e) {
      push({ kind: "error", title: "อัปโหลดสลิปไม่สำเร็จ", desc: errMsg(e) });
    }
  };

  // cost summary straight from the job row
  const SUMMARY = [
    { label: "รวมค่าอะไหล่", v: job?.partsCost ?? 0 },
    { label: "ค่าบริการการซ่อม", v: job?.serviceCost ?? 0 },
    { label: "ค่าเครื่องมือพิเศษ", v: job?.toolCost ?? 0 },
    { label: "ค่าขนส่ง", v: job?.deliveryCost ?? 0 },
    { label: "ค่ากล่องพัสดุ", v: job?.boxCost ?? 0 },
  ];
  const net = SUMMARY.reduce((s, x) => s + x.v, 0);

  React.useEffect(() => setQ(jobNo), [jobNo]);
  React.useEffect(() => {
    if (!job) return;
    reset(fromJob(job));
    setSlip(job.payment.slip);
    const today = new Date().toISOString().slice(0, 10);
    upd({
      payType: job.payment.type || PAYMENT_METHODS[0],
      payAmount: job.payment.amount > 0 ? String(job.payment.amount) : job.totalCost > 0 ? String(job.totalCost) : "",
      payDate: today,
      payNo: job.payment.no,
      payDetail: job.payment.detail,
      returnType: job.return.type,
      returnDate: job.return.date ? job.return.date.slice(0, 10) : today,
      courier: COURIERS.find((c) => job.return.detail.includes(c)) ?? "",
      tracking: job.return.tracking,
      returnDetail: job.return.detail,
      status: CLOSE_STATUS_OPTIONS.includes(job.status) ? job.status : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const go = async () => {
    const v = q.trim();
    if (!v) return;
    const j = await find(v);
    if (j) push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: j.no });
    else push({ kind: "error", title: "ไม่พบหมายเลขงาน", desc: v });
  };

  // POST /api/jobs/:no/close → payment + return fields, job_closed_date/by, status + job_log
  const save = async () => {
    if (!job) {
      push({ kind: "warning", title: "กรุณาระบุหมายเลขงานก่อน" });
      return;
    }
    if (!d.status) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "โปรดระบุสถานะงาน" });
      return;
    }
    if (!d.returnType) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องระบุวิธีการส่งคืนสินค้า" });
      return;
    }
    setSaving(true);
    try {
      await saveCommonSections(job.no, form, can("Job Management", "edit"));
      const r = await postJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(job.no)}/close`, {
        payment: { type: d.payType, amount: d.payAmount, date: d.payDate, no: d.payNo, detail: d.payDetail },
        return: { type: d.returnType, date: d.returnDate, courier: d.courier, tracking: d.tracking, detail: d.returnDetail },
        status: d.status,
      });
      setJob(r.job);
      push({ kind: "success", title: "ปิดงานและบันทึกการส่งคืนเรียบร้อย", desc: `${r.job.no} · ${r.job.status}` });
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="ปิดงาน - ส่งคืนสินค้า"
        description="ข้อมูลงานบริการ » ปิดงาน-ส่งคืนสินค้า"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="close-job-no"
              className="whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              ระบุ หมายเลขงาน
            </label>
            <div className="relative">
              <Input
                id="close-job-no"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && go()}
                placeholder="J2612164"
                className="num h-9 w-44 pr-8"
              />
              <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
            <Button size="md" onClick={go}>
              GO
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={!job}
              onClick={() => job && window.open(`/print/job/${encodeURIComponent(job.no)}/return`, "_blank")}
            >
              <Printer className="h-3.5 w-3.5" />
              พิมพ์ใบส่งคืน
            </Button>
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
          <Field label="ประเภทงาน">
            <ReadOnly>{job ? `${job.jobType}${job.warranty ? ` (${job.warranty === "IN" ? "In-Warranty" : "Out-Warranty"})` : ""}` : "—"}</ReadOnly>
          </Field>
          <Field label="สถานะงาน (ปัจจุบัน)">
            <ReadOnly>
              <Badge tone="success" dot>{job?.status ?? "—"}</Badge>
            </ReadOnly>
          </Field>
        </FieldGrid>
      </Section>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "product", label: "ข้อมูลสินค้า" },
          { key: "work", label: "รายละเอียดการดำเนินงาน" },
          { key: "payment", label: "รายละเอียดการรับชำระเงิน" },
        ]}
      />

      {tab === "product" && <ProductSection title="ข้อมูลสินค้า" />}

      {tab === "work" && (
        <Section title="รายละเอียดการดำเนินงาน" icon={ClipboardList}>
          <FieldGrid>
            <Field label="อาการเสีย (มาตรฐาน)" className="lg:col-span-2">
              <Textarea rows={2} readOnly value={form.symptoms.join(", ")} />
            </Field>
            <Field label="วิธีการซ่อมที่ดำเนินการ" className="lg:col-span-2">
              <Textarea rows={2} readOnly value={job?.repairDetail ?? ""} />
            </Field>
            <Field label="ช่างผู้รับผิดชอบ">
              <ReadOnly>{job?.engineer || "—"}</ReadOnly>
            </Field>
            <Field label="วันที่ซ่อมเสร็จ">
              <ReadOnly><span className="num">{job?.repairedDate || "—"}</span></ReadOnly>
            </Field>
          </FieldGrid>
        </Section>
      )}

      {tab === "payment" && (
        <Section title="รายละเอียดการรับชำระเงิน" icon={Wallet}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <ul className="space-y-2 text-sm">
                {SUMMARY.map((s) => (
                  <li key={s.label} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="num">{baht(s.v)}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
                  <span>รวมเป็นเงินสุทธิ</span>
                  <span className="num text-primary">{baht(net)} ฿</span>
                </li>
              </ul>
            </div>
            <FieldGrid cols={2}>
              <Field label="วิธีการชำระเงิน" required>
                <Select value={d.payType} onChange={(e) => upd({ payType: e.target.value })}>
                  {PAYMENT_METHODS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                  {d.payType && !PAYMENT_METHODS.includes(d.payType) && <option>{d.payType}</option>}
                </Select>
              </Field>
              <Field label="จำนวนเงินที่ชำระ (บาท)">
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={d.payAmount}
                  onChange={(e) => upd({ payAmount: e.target.value })}
                  onFocus={(e) => e.currentTarget.select()}
                  className="num text-right"
                />
              </Field>
              <Field label="วันที่ชำระเงิน">
                <Input type="date" value={d.payDate} onChange={(e) => upd({ payDate: e.target.value })} />
              </Field>
              <Field label="เลขที่ใบเสร็จ">
                <Input className="num" value={d.payNo} onChange={(e) => upd({ payNo: e.target.value })} />
              </Field>
              <Field label="สลิปหลักฐานการชำระ" wide>
                <div className="flex items-center gap-2">
                  <Input type="file" className="h-9 py-1.5 text-xs" accept=".jpg,.jpeg,.png,.webp,.pdf" disabled={!job} onChange={(e) => onPickSlip(e.target.files?.[0])} />
                  {slip && (
                    <a href={fileUrl(slip)} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-primary hover:underline">
                      ดูสลิป
                    </a>
                  )}
                </div>
              </Field>
              <Field label="หมายเหตุ" wide>
                <Textarea rows={2} value={d.payDetail} onChange={(e) => upd({ payDetail: e.target.value })} />
              </Field>
            </FieldGrid>
          </div>
        </Section>
      )}

      <Section title="ข้อมูลการปิดงาน - ส่งคืนสินค้า" icon={PackageCheck}>
        <FieldGrid>
          <Field label="วิธีการส่งคืนสินค้า" required>
            <Select value={d.returnType} onChange={(e) => upd({ returnType: e.target.value })}>
              <option value="">- - Please Select - -</option>
              {RETURN_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
              {d.returnType && !RETURN_METHODS.includes(d.returnType) && <option>{d.returnType}</option>}
            </Select>
          </Field>
          <Field label="วันที่ส่งคืน" required>
            <Input type="date" value={d.returnDate} onChange={(e) => upd({ returnDate: e.target.value })} />
          </Field>
          <Field label="บริษัทขนส่ง">
            <Select value={d.courier} onChange={(e) => upd({ courier: e.target.value })}>
              <option value="">- - Please Select - -</option>
              {COURIERS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="หมายเลขพัสดุ">
            <Input className="num" value={d.tracking} onChange={(e) => upd({ tracking: e.target.value })} />
          </Field>
          <Field label="รายละเอียดการส่งคืน" wide>
            <Textarea rows={2} value={d.returnDetail} onChange={(e) => upd({ returnDetail: e.target.value })} />
          </Field>
          <Field label="โปรดระบุ สถานะงาน" required wide>
            <Select value={d.status} onChange={(e) => upd({ status: e.target.value })}>
              <option value="">- - Please Select - -</option>
              {CLOSE_STATUS_OPTIONS.map((st) => (
                <option key={st}>{st}</option>
              ))}
            </Select>
          </Field>
        </FieldGrid>
      </Section>

      <FormActions saveLabel="ยืนยันปิดงาน" onSave={save} saving={saving} onCancel={() => job && reset(fromJob(job))} />
    </>
  );
}

export default function ClosePage() {
  return (
    <JobFormProvider>
      <React.Suspense fallback={null}>
        <CloseForm />
      </React.Suspense>
    </JobFormProvider>
  );
}
