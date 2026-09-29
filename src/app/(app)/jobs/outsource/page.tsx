"use client";

import * as React from "react";
import { Truck, PackageCheck, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { JobSearch } from "@/components/shared/job-search";
import { Section } from "@/components/shared/section";
import {
  CustomerSection,
  ProductSection,
  MainSymptomField,
  CostSummary,
  AttachmentSection,
  FormActions,
  JobFormProvider,
  useJobForm,
  fromJob,
  saveCommonSections,
  useWorkflowErrors,
} from "@/components/shared/job-form";
import { Tabs } from "@/components/ui/tabs";
import { SearchSelect, strOptions } from "@/components/shared/search-select";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { JOB_STATUS_OPTIONS } from "@/data/mock";
import { useVendors, useStaff } from "@/data/db";
import { RecordGate } from "@/components/shared/record-gate";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { useJob, type JobDetail } from "@/lib/use-job";
import { useAccess } from "@/lib/use-access";
import { postJson, errMsg } from "@/lib/api";
import { today as thaiToday } from "@/lib/dates";
import { outsourceActionSchema } from "@/lib/validation/job";

// ผู้รับซ่อมต่อ = ค่าที่เคยใช้ใน job_send_forward_dt.send_to_name (+ ค่าใหม่พิมพ์เพิ่มได้)
const OTHER = "อื่นๆ (ระบุ)";

function OutsourceForm() {
  const { push } = useToast();
  const { data: VENDORS } = useVendors();
  const { data: STAFF } = useStaff();
  const { userId: meId, can } = useAccess();
  // every job that arrives — from the URL, the search bar, or a save (setJob) — fills the form
  const { jobNo, job, loading, error, find, setJob } = useJob({
    onRecord: (j) => prefill(j),
    onLoaded: (j) => push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: j.no }),
    onMissing: (no) => push({ kind: "error", title: "ไม่พบหมายเลขงาน", desc: no }),
  });
  const { s: form, reset, set } = useJobForm();
  const act = useWorkflowErrors();
  const [tab, setTab] = React.useState("device");
  const [saving, setSaving] = React.useState(false);
  const [d, setD] = React.useState({
    repairDetail: "",
    sendTo: "",
    sendToOther: "",
    sendDate: "",
    sendBy: "", // app_user id (SearchSelect values are strings)
    sendDetail: "",
    recvFrom: "",
    recvDate: "",
    recvBy: "",
    recvDetail: "",
    status: "",
  });
  // editing a field clears its error (keys = the payload paths the rules report)
  const ERR_KEY: Partial<Record<keyof typeof d, string>> = {
    sendTo: "send.to",
    sendToOther: "send.to",
    sendDate: "send.date",
    sendBy: "send.by",
    recvBy: "receive.by",
    status: "status",
  };
  const upd = (p: Partial<typeof d>) => {
    setD((x) => ({ ...x, ...p }));
    (Object.keys(p) as (keyof typeof d)[]).forEach((k) => ERR_KEY[k] && act.clear(ERR_KEY[k]));
  };
  // what prefill last put on screen (the job as loaded / saved) — anything else is an unsaved edit
  const [saved, setSaved] = React.useState<typeof d | null>(null);
  useUnsavedChanges(!!saved && JSON.stringify(d) !== JSON.stringify(saved));


  // prefill from the job + its latest job_send_forward_dt row
  // the vendor list can arrive after the job: a saved "ส่งไปยัง" that turns out to be a known
  // vendor moves from "อื่นๆ" into the list (adjusted while rendering, once — then it matches)
  if (VENDORS.length && d.sendTo === OTHER && d.sendToOther && VENDORS.includes(d.sendToOther)) {
    const known = (x: typeof d) => (x.sendTo === OTHER && VENDORS.includes(x.sendToOther) ? { ...x, sendTo: x.sendToOther, sendToOther: "" } : x);
    setD(known);
    setSaved((x) => x && known(x)); // the same value, only shown the other way — not an edit
  }

  function prefill(job: JobDetail) {
    reset(fromJob(job));
    const last = job.outsource[job.outsource.length - 1];
    const today = thaiToday(); // Thai calendar, not UTC
    const next = {
      repairDetail: job.repairDetail,
      sendTo: last?.sendTo && VENDORS.includes(last.sendTo) ? last.sendTo : last?.sendTo ? OTHER : "",
      sendToOther: last?.sendTo && !VENDORS.includes(last.sendTo) ? last.sendTo : "",
      sendDate: last?.sendDate || today,
      sendBy: String(last?.sendById || meId),
      sendDetail: last?.sendDetail ?? "",
      recvFrom: last?.status === "ส่งเครื่องซ่อมแล้ว" ? last.sendTo : "",
      recvDate: last?.receiveDate ?? "",
      recvBy: last?.receiveById ? String(last.receiveById) : "",
      recvDetail: last?.receiveDetail ?? "",
      // the job's current status, so saving without a change keeps it (the field is required)
      status: JOB_STATUS_OPTIONS.includes(job.status) ? job.status : "",
    };
    upd(next);
    setSaved(next);
  }

  const go = (v: string) => find(v);

  const open = job?.outsource.find((o) => o.status === "ส่งเครื่องซ่อมแล้ว");

  // POST /api/jobs/:no/outsource → job_send_forward_dt (send / receive) + status 14/15 + job_log
  const save = async () => {
    if (!job) return; // the save bar only shows once a job is loaded (RecordGate)
    const sendTo = d.sendTo === OTHER ? d.sendToOther.trim() : d.sendTo;
    const receiving = !!open && (d.recvDate || d.recvDetail);
    const body = {
      symptomOther: form.symptomOther,
      repairDetail: d.repairDetail,
      send: !receiving ? { to: sendTo, date: d.sendDate, detail: d.sendDetail, by: Number(d.sendBy) || undefined } : undefined,
      receive: receiving ? { from: d.recvFrom, date: d.recvDate, detail: d.recvDetail, by: Number(d.recvBy || meId) || undefined } : undefined,
      status: d.status || undefined,
    };
    const canEdit = can("Job Management", "edit");
    if (!act.check(outsourceActionSchema, body, canEdit)) return;
    setSaving(true);
    try {
      await saveCommonSections(job.no, form, canEdit);
      const r = await postJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(job.no)}/outsource`, body);
      setJob(r.job);
      push({ kind: "success", title: "บันทึกข้อมูลส่งซ่อมต่อแล้ว", desc: `${r.job.no} · ${r.job.status}` });
    } catch (e) {
      if (!act.fromApi(e)) push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  // ส่งโดย / รับโดย store the person's app_user id; someone already saved on this job who is no
  // longer in the staff list (left) stays selectable so they are not silently replaced
  const staffOptions = React.useMemo(() => {
    const opts = STAFF.map((st) => ({ value: String(st.id), label: st.name, sub: st.id === meId ? "ฉัน" : st.userType || undefined }));
    const last = job?.outsource[job.outsource.length - 1];
    const saved = [
      { id: last?.sendById, name: last?.sendBy },
      { id: last?.receiveById, name: last?.receiveBy },
    ];
    for (const p of saved) {
      if (p.id && !opts.some((o) => o.value === String(p.id)))
        opts.unshift({ value: String(p.id), label: p.name || `#${p.id}`, sub: "ไม่อยู่ในรายชื่อปัจจุบัน" });
    }
    return opts;
  }, [STAFF, meId, job]);

  return (
    <>
      <PageHeader
        title="บันทึกงานส่งซ่อมต่อ (Out-Source)"
        description="ข้อมูลงานซ่อม » บันทึกข้อมูลส่งซ่อม Out-Source"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="outsource-job-no" className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              ระบุ หมายเลขงานซ่อม
            </label>
            <JobSearch id="outsource-job-no" value={jobNo} scope="open" onPick={go} />
          </div>
        }
      />

      <RecordGate ready={!!job} loading={loading} error={error} noun="งาน" searchId="outsource-job-no">
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
          <ProductSection title="ข้อมูลเครื่องซ่อม" variant="repair" />
        ) : (
          <Section title="รายละเอียดการซ่อม" icon={ClipboardList}>
            <FieldGrid>
              <MainSymptomField />
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
            <Field label="ส่งไปยัง" required error={act.errors["send.to"]} className="lg:col-span-2">
              <div className="space-y-2">
                <SearchSelect value={d.sendTo} onChange={(v) => upd({ sendTo: v })} options={strOptions([...VENDORS, OTHER])} searchPlaceholder="พิมพ์ชื่อผู้รับซ่อมต่อ…" />
                {d.sendTo === OTHER && (
                  <Input placeholder="ระบุชื่อผู้รับซ่อมต่อ" value={d.sendToOther} onChange={(e) => upd({ sendToOther: e.target.value })} />
                )}
              </div>
            </Field>
            <Field label="วันที่ส่ง" required error={act.errors["send.date"]}>
              <Input type="date" value={d.sendDate} onChange={(e) => upd({ sendDate: e.target.value })} />
            </Field>
            <Field label="ส่งโดย" required error={act.errors["send.by"]}>
              <SearchSelect value={d.sendBy} onChange={(v) => upd({ sendBy: v })} options={staffOptions} searchPlaceholder="พิมพ์ชื่อผู้ส่ง…" />
            </Field>
            <Field label="หมายเหตุการส่ง" wide>
              <Textarea rows={2} value={d.sendDetail} onChange={(e) => upd({ sendDetail: e.target.value })} />
            </Field>
          </FieldGrid>
        </Section>

        <Section title="รายละเอียด การรับคืนงานซ่อม" icon={PackageCheck}>
          <FieldGrid>
            <Field label="รับจาก" className="lg:col-span-2">
              <SearchSelect
                value={d.recvFrom}
                onChange={(v) => upd({ recvFrom: v })}
                options={strOptions(d.recvFrom && !VENDORS.includes(d.recvFrom) ? [d.recvFrom, ...VENDORS] : VENDORS)}
                searchPlaceholder="พิมพ์ชื่อผู้รับซ่อมต่อ…"
              />
            </Field>
            <Field label="วันที่รับ">
              <Input type="date" value={d.recvDate} onChange={(e) => upd({ recvDate: e.target.value })} />
            </Field>
            <Field label="รับโดย" error={act.errors["receive.by"]}>
              <SearchSelect value={d.recvBy || String(meId)} onChange={(v) => upd({ recvBy: v })} options={staffOptions} searchPlaceholder="พิมพ์ชื่อผู้รับ…" />
            </Field>
            <Field label="หมายเหตุการรับคืน" wide>
              <Textarea rows={2} value={d.recvDetail} onChange={(e) => upd({ recvDetail: e.target.value })} />
            </Field>
            <Field label="โปรดระบุ สถานะงานซ่อม" required wide error={act.errors.status}>
              <SearchSelect value={d.status} onChange={(v) => upd({ status: v })} options={strOptions(JOB_STATUS_OPTIONS)} searchPlaceholder="พิมพ์ชื่อสถานะ…" />
            </Field>
          </FieldGrid>
        </Section>

        <CostSummary />
        <AttachmentSection jobNo={job?.no} />

        <FormActions saveLabel="บันทึกข้อมูล Out-Source" onSave={save} saving={saving} cancelHref="/jobs/list" />
      </RecordGate>
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
