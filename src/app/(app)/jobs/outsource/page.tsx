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
  JobFormProvider,
  useJobForm,
  fromJob,
} from "@/components/shared/job-form";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { JOB_STATUS_OPTIONS } from "@/data/mock";
import { useVendors, useStaff } from "@/data/db";
import { useJob, type JobDetail } from "@/lib/use-job";
import { useAccess } from "@/lib/use-access";
import { postJson, errMsg } from "@/lib/api";

// ผู้รับซ่อมต่อ = ค่าที่เคยใช้ใน job_send_forward_dt.send_to_name (+ ค่าใหม่พิมพ์เพิ่มได้)
const OTHER = "อื่นๆ (ระบุ)";

function OutsourceForm() {
  const { push } = useToast();
  const { data: VENDORS } = useVendors();
  const { data: STAFF } = useStaff();
  const { name: me } = useAccess();
  const { jobNo, job, find, setJob } = useJob();
  const { s: form, reset, set } = useJobForm();
  const [tab, setTab] = React.useState("device");
  const [q, setQ] = React.useState(jobNo);
  const [saving, setSaving] = React.useState(false);
  const [d, setD] = React.useState({
    repairDetail: "",
    sendTo: "",
    sendToOther: "",
    sendDate: "",
    sendBy: "",
    sendDetail: "",
    recvFrom: "",
    recvDate: "",
    recvBy: "",
    recvDetail: "",
    status: "",
  });
  const upd = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));

  React.useEffect(() => setQ(jobNo), [jobNo]);

  // prefill from the job + its latest job_send_forward_dt row
  React.useEffect(() => {
    if (!job) return;
    reset(fromJob(job));
    const last = job.outsource[job.outsource.length - 1];
    const today = new Date().toISOString().slice(0, 10);
    upd({
      repairDetail: job.repairDetail,
      sendTo: last?.sendTo && VENDORS.includes(last.sendTo) ? last.sendTo : last?.sendTo ? OTHER : "",
      sendToOther: last?.sendTo && !VENDORS.includes(last.sendTo) ? last.sendTo : "",
      sendDate: last?.sendDate || today,
      sendBy: last?.sendBy || me,
      sendDetail: last?.sendDetail ?? "",
      recvFrom: last?.status === "ส่งเครื่องซ่อมแล้ว" ? last.sendTo : "",
      recvDate: last?.receiveDate ?? "",
      recvBy: last?.receiveBy || "",
      recvDetail: last?.receiveDetail ?? "",
      status: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, VENDORS.length]);

  const go = async () => {
    const v = q.trim();
    if (!v) return;
    const j = await find(v);
    if (j) push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: j.no });
    else push({ kind: "error", title: "ไม่พบหมายเลขงาน", desc: v });
  };

  const open = job?.outsource.find((o) => o.status === "ส่งเครื่องซ่อมแล้ว");

  // POST /api/jobs/:no/outsource → job_send_forward_dt (send / receive) + status 14/15 + job_log
  const save = async () => {
    if (!job) {
      push({ kind: "warning", title: "กรุณาระบุหมายเลขงานก่อน" });
      return;
    }
    const sendTo = d.sendTo === OTHER ? d.sendToOther.trim() : d.sendTo;
    const receiving = !!open && (d.recvDate || d.recvDetail);
    if (!receiving && !sendTo) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องระบุ ส่งไปยัง" });
      return;
    }
    setSaving(true);
    try {
      const r = await postJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(job.no)}/outsource`, {
        symptomOther: form.symptomOther,
        repairDetail: d.repairDetail,
        send: !receiving ? { to: sendTo, date: d.sendDate, detail: d.sendDetail } : undefined,
        receive: receiving ? { from: d.recvFrom, date: d.recvDate, detail: d.recvDetail } : undefined,
        status: d.status || undefined,
      });
      setJob(r.job);
      push({ kind: "success", title: "บันทึกข้อมูลส่งซ่อมต่อแล้ว", desc: `${r.job.no} · ${r.job.status}` });
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const staffNames = React.useMemo(() => {
    const names = STAFF.map((s) => s.name);
    return me && !names.includes(me) ? [me, ...names] : names;
  }, [STAFF, me]);

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
                placeholder="J2612164"
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
            <ReadOnly><span className="num">{job?.no ?? "—"}</span></ReadOnly>
          </Field>
          <Field label="วันที่เปิดงานซ่อม">
            <ReadOnly><span className="num">{job ? `${job.createDate} น.` : "—"}</span></ReadOnly>
          </Field>
          <Field label="เปิดงานซ่อมโดย">
            <ReadOnly>{job?.createByName || "—"}</ReadOnly>
          </Field>
          <Field label="สถานะงานซ่อม (ปัจจุบัน)">
            <ReadOnly>
              <Badge tone="info" dot>{job?.status ?? "—"}</Badge>
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
              <Textarea rows={2} readOnly value={form.symptoms.join(", ")} />
            </Field>
            <Field label="อาการเสีย (อื่นๆ)" className="lg:col-span-2">
              <Textarea rows={2} value={form.symptomOther} onChange={(e) => set("symptomOther", e.target.value)} />
            </Field>
            <Field label="วิธีการซ่อมเบื้องต้น" wide>
              <Textarea rows={3} value={d.repairDetail} onChange={(e) => upd({ repairDetail: e.target.value })} />
            </Field>
          </FieldGrid>
        </Section>
      )}

      <Section title="รายละเอียด การส่งงานซ่อม" icon={Truck}>
        <FieldGrid>
          <Field label="ส่งไปยัง" required className="lg:col-span-2">
            <div className="space-y-2">
              <Select value={d.sendTo} onChange={(e) => upd({ sendTo: e.target.value })}>
                <option value="">- - Please Select - -</option>
                {VENDORS.map((v) => (
                  <option key={v}>{v}</option>
                ))}
                <option>{OTHER}</option>
              </Select>
              {d.sendTo === OTHER && (
                <Input placeholder="ระบุชื่อผู้รับซ่อมต่อ" value={d.sendToOther} onChange={(e) => upd({ sendToOther: e.target.value })} />
              )}
            </div>
          </Field>
          <Field label="วันที่ส่ง" required>
            <Input type="date" value={d.sendDate} onChange={(e) => upd({ sendDate: e.target.value })} />
          </Field>
          <Field label="ส่งโดย" required>
            <Select value={d.sendBy} onChange={(e) => upd({ sendBy: e.target.value })}>
              {staffNames.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="หมายเหตุการส่ง" wide>
            <Textarea rows={2} value={d.sendDetail} onChange={(e) => upd({ sendDetail: e.target.value })} />
          </Field>
        </FieldGrid>
      </Section>

      <Section title="รายละเอียด การรับคืนงานซ่อม" icon={PackageCheck}>
        <FieldGrid>
          <Field label="รับจาก" className="lg:col-span-2">
            <Select value={d.recvFrom} onChange={(e) => upd({ recvFrom: e.target.value })}>
              <option value="">- - Please Select - -</option>
              {VENDORS.map((v) => (
                <option key={v}>{v}</option>
              ))}
              {d.recvFrom && !VENDORS.includes(d.recvFrom) && <option>{d.recvFrom}</option>}
            </Select>
          </Field>
          <Field label="วันที่รับ">
            <Input type="date" value={d.recvDate} onChange={(e) => upd({ recvDate: e.target.value })} />
          </Field>
          <Field label="รับโดย">
            <Select value={d.recvBy || me} onChange={(e) => upd({ recvBy: e.target.value })}>
              {staffNames.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="หมายเหตุการรับคืน" wide>
            <Textarea rows={2} value={d.recvDetail} onChange={(e) => upd({ recvDetail: e.target.value })} />
          </Field>
          <Field label="โปรดระบุ สถานะงานซ่อม" required wide>
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

      <FormActions saveLabel="บันทึกข้อมูล Out-Source" onSave={save} saving={saving} onCancel={() => job && reset(fromJob(job))} />
    </>
  );
}

export default function OutsourcePage() {
  return (
    <JobFormProvider>
      <React.Suspense fallback={null}>
        <OutsourceForm />
      </React.Suspense>
    </JobFormProvider>
  );
}
