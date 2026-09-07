"use client";

import * as React from "react";
import { Plus, Trash2, Wrench, Stethoscope, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Section } from "@/components/shared/section";
import {
  CustomerSection,
  ProductSection,
  CostSummary,
  OtherInfoSection,
  AttachmentSection,
  FormActions,
} from "@/components/shared/job-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, Textarea, Checkbox, NumberInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { REPAIR_STATUS_OPTIONS } from "@/data/mock";
import { useProducts, useSymptoms } from "@/data/db";
import { baht } from "@/lib/utils";

type Line = {
  id: number;
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
};

export default function RepairPage() {
  const { push } = useToast();
  const { data: PRODUCTS } = useProducts();
  const { data: SYMPTOMS } = useSymptoms();
  const [lines, setLines] = React.useState<Line[]>([]);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const idRef = React.useRef(0);

  const go = () => {
    const v = q.trim() || "JOB2604460";
    push({ kind: "success", title: "เรียกข้อมูลงานสำเร็จ", desc: v });
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
    setPickerOpen(false);
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
            <label
              htmlFor="repair-job-no"
              className="whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              ระบุ หมายเลขงาน
            </label>
            <div className="relative">
              <Input
                id="repair-job-no"
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

      <Section title="ข้อมูลการเปิดงานซ่อม" icon={Wrench}>
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
          <Field label="ประเภทงานซ่อม">
            <ReadOnly>ซ่อมในประกัน (In-Warranty)</ReadOnly>
          </Field>
          <Field label="สถานะงานซ่อม (ปัจจุบัน)" wide>
            <ReadOnly>
              <Badge tone="warning" dot>อยู่ระหว่างดำเนินการ</Badge>
            </ReadOnly>
          </Field>
        </FieldGrid>
      </Section>

      <ProductSection title="ข้อมูลเครื่องซ่อม" />

      <Section
        title="การใช้อะไหล่ และการเสนอราคา"
        icon={Stethoscope}
        description="เสนอราคาแบบ A (Normal) และแบบ B (VIP)"
        actions={
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            เลือกรายการอะไหล่
          </Button>
        }
        bodyClassName="p-0"
      >
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
                    ยังไม่มีรายการอะไหล่ — กด “เลือกรายการอะไหล่” เพื่อเพิ่ม
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
                      <Checkbox checked={l.aPick} onChange={() => upd(l.id, { aPick: !l.aPick })} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Checkbox checked={l.aQuote} onChange={() => upd(l.id, { aQuote: !l.aQuote })} />
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput
                        min={0}
                        placeholder="0"
                        value={l.aQty}
                        onChange={(n) => upd(l.id, { aQty: n })}
                        className="h-7 w-14 px-1.5 text-xs"
                      />
                    </td>
                    <td className="num px-2 py-2 text-right">
                      {baht(l.aQuote ? l.price * l.aQty : 0)}
                    </td>

                    <td className="border-l border-border px-2 py-2 text-center">
                      <Checkbox checked={l.bPick} onChange={() => upd(l.id, { bPick: !l.bPick })} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Checkbox checked={l.bQuote} onChange={() => upd(l.id, { bQuote: !l.bQuote })} />
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput
                        min={0}
                        placeholder="0"
                        value={l.bQty}
                        onChange={(n) => upd(l.id, { bQty: n })}
                        className="h-7 w-14 px-1.5 text-xs"
                      />
                    </td>
                    <td className="num px-2 py-2 text-right">
                      {baht(l.bQuote ? l.price * l.bQty : 0)}
                    </td>

                    <td className="px-2 py-2">
                      <Badge tone={l.status === "พร้อมเบิก" ? "success" : "danger"} dot>
                        {l.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => setLines((s) => s.filter((x) => x.id !== l.id))}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                        aria-label="ลบ"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
          <Field label="อาการเสียที่ตรวจพบ" wide>
            <Select defaultValue="">
              <option value="">- - เลือกอาการเสีย - -</option>
              {SYMPTOMS.map((s) => (
                <option key={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="วิธีการซ่อม" className="lg:col-span-2">
            <Textarea rows={3} placeholder="อธิบายขั้นตอนการซ่อมที่ดำเนินการ" />
          </Field>
          <Field label="หมายเหตุ" className="lg:col-span-2">
            <Textarea rows={3} />
          </Field>
          <Field label="New Serial No.">
            <Input className="num" />
          </Field>
          <Field label="สถานะงานซ่อม" required>
            <Select defaultValue="">
              <option value="">- - Please Select - -</option>
              {REPAIR_STATUS_OPTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </FieldGrid>
      </Section>

      <CostSummary partsTotal={totalA} />
      <OtherInfoSection />
      <AttachmentSection />

      <FormActions
        saveLabel="บันทึกงานซ่อม"
        onSave={() => push({ kind: "success", title: "บันทึกงานซ่อมเรียบร้อย" })}
      />

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="เลือกรายการอะไหล่"
        description="คลิกที่รายการเพื่อเพิ่มเข้าใบงานซ่อม"
        size="xl"
      >
        <div className="table-scroll border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-2xs uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left">รหัส</th>
                <th className="px-3 py-2 text-left">ชื่ออะไหล่</th>
                <th className="px-3 py-2 text-right">คงเหลือ</th>
                <th className="px-3 py-2 text-right">ราคา</th>
                <th className="px-3 py-2 text-center">เลือก</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTS.map((p) => (
                <tr key={p.sysCode} className="border-b border-border/70 last:border-0 hover:bg-accent/50">
                  <td className="num px-3 py-2 font-medium">{p.sysCode}</td>
                  <td className="px-3 py-2">
                    <span className="line-clamp-1 max-w-[380px]">{p.name}</span>
                  </td>
                  <td className="num px-3 py-2 text-right">{p.onhand}</td>
                  <td className="num px-3 py-2 text-right">{baht(p.price)}</td>
                  <td className="px-3 py-2 text-center">
                    <Button size="sm" variant="outline" onClick={() => addPart(p.sysCode)}>
                      เพิ่ม
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  );
}
