"use client";

import * as React from "react";
import { Plus, Trash2, Wrench, Stethoscope } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { JobSearch } from "@/components/shared/job-search";
import { Section } from "@/components/shared/section";
import {
  CustomerSection,
  ProductSection,
  CostSummary,
  OtherInfoSection,
  AttachmentSection,
  FormActions,
  JobFormProvider,
  useJobForm,
  fromJob,
  saveCommonSections,
} from "@/components/shared/job-form";
import { useAccess } from "@/lib/use-access";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Textarea, Checkbox, NumberInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { REPAIR_STATUS_OPTIONS } from "@/data/mock";
import { ProductPicker } from "@/components/shared/product-picker";
import { SearchSelect, strOptions } from "@/components/shared/search-select";
import { SymptomPicker } from "@/components/shared/symptom-picker";
import { useProducts, useSymptoms, useSymptomStats, useModelSymptoms } from "@/data/db";
import { baht } from "@/lib/utils";
import { useJob, type JobDetail } from "@/lib/use-job";
import { PrintButton } from "@/components/shared/print-button";
import { postJson, errMsg } from "@/lib/api";

type Line = {
  id: number;
  logId?: number; // existing job_order_spare_part_log row
  code: string;
  name: string;
  price: number;
  aPick: boolean;
  aQuote: boolean;
  aQty: number;
  bPick: boolean;
  bQuote: boolean;
  bQty: number;
  status: string;
  locked?: boolean; // already issued / returned — read-only
};

function RepairForm() {
  const { push } = useToast();
  const { data: PRODUCTS } = useProducts();
  const { data: SYMPTOMS } = useSymptoms();
  const { data: SYMPTOM_STATS } = useSymptomStats();
  const { jobNo, job, find, setJob } = useJob();
  const { s: form, reset } = useJobForm();
  const { data: MODEL_SYMPTOMS } = useModelSymptoms(form.modelCode);
  const { can } = useAccess();
  const [lines, setLines] = React.useState<Line[]>([]);
  const [detail, setDetail] = React.useState({ engineerSymptom: "", repairDetail: "", engineerRemark: "", newSerial: "", status: "" });
  const [saving, setSaving] = React.useState(false);
  const idRef = React.useRef(0);


  // prefill form, repair details and spare-part requests from the loaded job
  React.useEffect(() => {
    if (!job) return;
    reset(fromJob(job));
    setDetail({
      engineerSymptom: job.engineerSymptom,
      repairDetail: job.repairDetail,
      engineerRemark: job.engineerRemark,
      newSerial: "",
      status: REPAIR_STATUS_OPTIONS.includes(job.status) ? job.status : "",
    });
    setLines(
      job.parts.map((p) => ({
        id: ++idRef.current,
        logId: p.logId,
        code: p.code,
        name: p.name,
        price: p.unitPrice,
        aPick: p.isSpecial,
        aQuote: p.isQuotation,
        aQty: p.requested,
        bPick: p.isSpecialB,
        bQuote: p.isQuotationB,
        bQty: p.requestQtyB,
        status: p.status,
        locked: p.statusId !== 1 || p.granted > 0,
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  const go = async (v: string) => {
    if (!v) return;
    const j = await find(v);
    if (j) push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: j.no });
    else push({ kind: "error", title: "ไม่พบหมายเลขงาน", desc: v });
  };

  // POST /api/jobs/:no/repair → job fields, costs, job_order_spare_part_log (+ booking), status + job_log
  const save = async () => {
    if (!job) {
      push({ kind: "warning", title: "กรุณาระบุหมายเลขงานก่อน" });
      return;
    }
    setSaving(true);
    try {
      // product / other-info sections shown on this screen are saved too
      await saveCommonSections(job.no, form, can("Job Management", "edit"));
      const d = await postJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(job.no)}/repair`, {
        ...detail,
        status: detail.status || undefined,
        serviceCost: form.serviceCost,
        toolCost: form.toolCost,
        deliveryCost: form.deliveryCost,
        boxCost: form.boxCost,
        parts: lines.map((l) => ({
          logId: l.logId,
          code: l.code,
          unitPrice: l.price,
          a: { pick: l.aPick, quote: l.aQuote, qty: l.aQty },
          b: { pick: l.bPick, quote: l.bQuote, qty: l.bQty },
        })),
      });
      setJob(d.job);
      push({ kind: "success", title: "บันทึกงานซ่อมเรียบร้อย", desc: `${d.job.no} · ${d.job.status}` });
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const addPart = (code: string) => {
    const p = PRODUCTS.find((x) => x.sysCode === code);
    if (!p) return;
    setLines((s) => [
      ...s,
      {
        id: ++idRef.current,
        code: p.sysCode,
        name: p.name,
        price: p.price,
        aPick: true,
        aQuote: true,
        aQty: 1,
        bPick: false,
        bQuote: false,
        bQty: 0,
        status: p.onhand > 0 ? "พร้อมเบิก" : "รออะไหล่",
      },
    ]);
  };

  const upd = (id: number, patch: Partial<Line>) =>
    setLines((s) => s.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const totalA = lines.reduce((s, l) => s + (l.aQuote ? l.price * l.aQty : 0), 0);
  const totalB = lines.reduce((s, l) => s + (l.bQuote ? l.price * l.bQty : 0), 0);

  return (
    <>
      <PageHeader
        title="บันทึกงานซ่อม"
        description="ข้อมูลงาน » บันทึกการทำงาน — บันทึกอะไหล่ที่ใช้ วิธีการซ่อม และค่าใช้จ่าย"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="repair-job-no" className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              ระบุ หมายเลขงาน
            </label>
            <JobSearch id="repair-job-no" value={jobNo} scope="open" onPick={go} />
          </div>
        }
      />

      <CustomerSection readOnly />

      <Section title="ข้อมูลการเปิดงานซ่อม" icon={Wrench}>
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
          <Field label="ประเภทงานซ่อม">
            <ReadOnly>{job ? `${job.jobType}${job.warranty ? ` (${job.warranty === "IN" ? "In-Warranty" : "Out-Warranty"})` : ""}` : "—"}</ReadOnly>
          </Field>
          <Field label="สถานะงานซ่อม (ปัจจุบัน)" wide>
            <ReadOnly>
              <Badge tone="warning" dot>{job?.status ?? "—"}</Badge>
            </ReadOnly>
          </Field>
        </FieldGrid>
      </Section>

      <ProductSection title="ข้อมูลเครื่องซ่อม" variant="repair" />

      <Section
        title="การใช้อะไหล่ และการเสนอราคา"
        icon={Stethoscope}
        description="เสนอราคาแบบ A (Normal) และแบบ B (VIP)"
        bodyClassName="p-0"
      >
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <ProductPicker
            products={PRODUCTS}
            onPick={(p) => p && addPart(p.code)}
            placeholder="เพิ่มอะไหล่ — ค้นหา ชื่อ / รหัส / เลข part / ยี่ห้อ…"
            className="sm:max-w-xl"
          />
        </div>
        <div className="table-scroll rounded-none">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                <th rowSpan={2} className="w-10 px-2 py-2 text-left">#</th>
                <th rowSpan={2} className="w-24 px-2 py-2 text-left">รหัสอะไหล่</th>
                <th rowSpan={2} className="px-2 py-2 text-left">รายละเอียด</th>
                <th rowSpan={2} className="w-24 px-2 py-2 text-right">ราคา/หน่วย</th>
                <th colSpan={4} className="border-l border-border px-2 py-1.5 text-center">
                  เสนอราคาแบบ A (Normal)
                </th>
                <th colSpan={4} className="border-l border-border px-2 py-1.5 text-center">
                  เสนอราคาแบบ B (VIP)
                </th>
                <th rowSpan={2} className="w-24 px-2 py-2 text-left">สถานะ</th>
                <th rowSpan={2} className="w-16 px-2 py-2 text-center">Action</th>
              </tr>
              <tr className="border-b border-border bg-muted/60 text-2xs text-muted-foreground">
                <th className="w-14 border-l border-border px-2 py-1.5 text-center">เบิก</th>
                <th className="w-14 px-2 py-1.5 text-center">เสนอ</th>
                <th className="w-16 px-2 py-1.5 text-center">Qty</th>
                <th className="w-24 px-2 py-1.5 text-right">เป็นเงิน</th>
                <th className="w-14 border-l border-border px-2 py-1.5 text-center">เบิก</th>
                <th className="w-14 px-2 py-1.5 text-center">เสนอ</th>
                <th className="w-16 px-2 py-1.5 text-center">Qty</th>
                <th className="w-24 px-2 py-1.5 text-right">เป็นเงิน</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-3 py-10 text-center text-xs text-muted-foreground">
                    ยังไม่มีรายการอะไหล่ — ค้นหาในช่องด้านบนเพื่อเพิ่ม
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => (
                  <tr key={l.id} className="border-b border-border/70 hover:bg-accent/50">
                    <td className="num px-2 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="num px-2 py-2 font-medium">{l.code}</td>
                    <td className="px-2 py-2">
                      <span className="line-clamp-2 max-w-[280px]">{l.name}</span>
                    </td>
                    <td className="num px-2 py-2 text-right">{baht(l.price)}</td>

                    <td className="border-l border-border px-2 py-2 text-center">
                      <Checkbox checked={l.aPick} disabled={l.locked} onChange={() => upd(l.id, { aPick: !l.aPick })} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Checkbox checked={l.aQuote} disabled={l.locked} onChange={() => upd(l.id, { aQuote: !l.aQuote })} />
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput
                        min={0}
                        placeholder="0"
                        value={l.aQty}
                        disabled={l.locked}
                        onChange={(n) => upd(l.id, { aQty: n })}
                        className="h-7 w-14 px-1.5 text-xs"
                      />
                    </td>
                    <td className="num px-2 py-2 text-right">
                      {baht(l.aQuote ? l.price * l.aQty : 0)}
                    </td>

                    <td className="border-l border-border px-2 py-2 text-center">
                      <Checkbox checked={l.bPick} disabled={l.locked} onChange={() => upd(l.id, { bPick: !l.bPick })} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Checkbox checked={l.bQuote} disabled={l.locked} onChange={() => upd(l.id, { bQuote: !l.bQuote })} />
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput
                        min={0}
                        placeholder="0"
                        value={l.bQty}
                        disabled={l.locked}
                        onChange={(n) => upd(l.id, { bQty: n })}
                        className="h-7 w-14 px-1.5 text-xs"
                      />
                    </td>
                    <td className="num px-2 py-2 text-right">
                      {baht(l.bQuote ? l.price * l.bQty : 0)}
                    </td>

                    <td className="px-2 py-2">
                      <Badge tone={/พร้อม|จ่ายแล้ว|คืนแล้ว/.test(l.status) ? "success" : /รออะไหล่/.test(l.status) ? "danger" : "warning"} dot>
                        {l.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-center">
                      {!l.locked && (
                        <button
                          onClick={() => setLines((s) => s.filter((x) => x.id !== l.id))}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                          aria-label="ลบ"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="bg-muted/50 font-semibold">
                  <td colSpan={7} className="px-2 py-2 text-right text-xs">
                    รวมแบบ A
                  </td>
                  <td className="num px-2 py-2 text-right text-primary">{baht(totalA)}</td>
                  <td colSpan={3} className="px-2 py-2 text-right text-xs">
                    รวมแบบ B
                  </td>
                  <td className="num px-2 py-2 text-right text-primary">{baht(totalB)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Section>

      <Section title="รายละเอียดการซ่อม" icon={Wrench}>
        <FieldGrid>
          <Field label="อาการเสียที่ตรวจพบ" wide hint="เลือกได้ 1 อาการ (engineer_symptom_id)">
            <SymptomPicker
              multiple={false}
              value={detail.engineerSymptom ? [detail.engineerSymptom] : []}
              onChange={(names) => setDetail((d) => ({ ...d, engineerSymptom: names[0] ?? "" }))}
              options={SYMPTOM_STATS.length ? SYMPTOM_STATS : SYMPTOMS.map((sy) => ({ id: Number(sy.id), name: sy.name }))}
              suggested={MODEL_SYMPTOMS}
              suggestedLabel="อาการที่พบบ่อยของรุ่นนี้"
              placeholder="พิมพ์ค้นหาอาการที่ตรวจพบ…"
            />
          </Field>
          <Field label="วิธีการซ่อม" className="lg:col-span-2">
            <Textarea
              rows={3}
              placeholder="อธิบายขั้นตอนการซ่อมที่ดำเนินการ"
              value={detail.repairDetail}
              onChange={(e) => setDetail((d) => ({ ...d, repairDetail: e.target.value }))}
            />
          </Field>
          <Field label="หมายเหตุ" className="lg:col-span-2">
            <Textarea rows={3} value={detail.engineerRemark} onChange={(e) => setDetail((d) => ({ ...d, engineerRemark: e.target.value }))} />
          </Field>
          <Field label="New Serial No.">
            <Input className="num" value={detail.newSerial} onChange={(e) => setDetail((d) => ({ ...d, newSerial: e.target.value }))} />
          </Field>
          <Field label="สถานะงานซ่อม" required>
            <SearchSelect value={detail.status} onChange={(v) => setDetail((d) => ({ ...d, status: v }))} options={strOptions(REPAIR_STATUS_OPTIONS)} minWidth={360} searchPlaceholder="พิมพ์ชื่อสถานะ…" />
          </Field>
        </FieldGrid>
      </Section>

      <CostSummary partsTotal={totalA} />
      <OtherInfoSection />
      <AttachmentSection jobNo={job?.no} />

      <FormActions
        saveLabel="บันทึกงานซ่อม"
        onSave={save}
        saving={saving}
        onCancel={() => job && reset(fromJob(job))}
        extra={
          <PrintButton label="พิมพ์ใบรับงาน" kind="job" no={job?.no ?? ""} profileId={job?.documentProfileId} href={`/print/job/${encodeURIComponent(job?.no ?? "")}`} disabled={!job} />
        }
      />

    </>
  );
}

export default function RepairPage() {
  return (
    <JobFormProvider>
      <React.Suspense fallback={null}>
        <RepairForm />
      </React.Suspense>
    </JobFormProvider>
  );
}
