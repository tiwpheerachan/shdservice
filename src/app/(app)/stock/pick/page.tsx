"use client";

import * as React from "react";
import { PackageMinus, Save, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, NumberInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useProducts, useJobs } from "@/data/db";
import { TECHNICIANS, STOCK_PICK_TYPES } from "@/data/mock";
import { int, cn } from "@/lib/utils";

const DOC_TYPES = STOCK_PICK_TYPES;

const RECIPIENTS = [
  "ศูนย์ซ่อม รังสิต",
  "ศูนย์ซ่อม บางนา",
  "คลังกลาง",
  ...TECHNICIANS.slice(1),
];

type Line = {
  docNo: string;
  code: string;
  name: string;
  pickStatus: string;
  onhand: number;
  need: number;
  issue: number;
};

export default function PickPage() {
  const { push } = useToast();
  const { data: PRODUCTS } = useProducts();
  const { data: JOBS } = useJobs();

  const [docType, setDocType] = React.useState(DOC_TYPES[0]);
  const [ref, setRef] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [payTo, setPayTo] = React.useState("");
  const [remark, setRemark] = React.useState("");
  const [docDate, setDocDate] = React.useState("");

  // stamp document date on the client only (avoids SSR/hydration mismatch)
  React.useEffect(() => {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    setDocDate(
      `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ` +
        `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
    );
  }, []);

  const refOptions = JOBS.slice(0, 15).map((j) => j.no);

  const getData = () => {
    if (!ref) {
      push({ kind: "warning", title: "กรุณาเลือกอ้างอิงเลขเอกสารก่อน" });
      return;
    }
    const items = PRODUCTS.slice(0, 4).map((p, i) => ({
      docNo: ref,
      code: p.sysCode,
      name: p.name,
      pickStatus: p.onhand === 0 ? "รออะไหล่" : i % 3 === 0 ? "เบิกบางส่วน" : "รอเบิก",
      onhand: p.onhand,
      need: (i % 3) + 1,
      issue: 0,
    }));
    setLines(items);
    setLoaded(true);
    push({ kind: "success", title: "ดึงรายการเบิกแล้ว", desc: `${ref} — ${items.length} รายการ` });
  };

  const setIssue = (code: string, v: number) =>
    setLines((s) =>
      s.map((l) =>
        l.code === code
          ? { ...l, issue: Math.max(0, Math.min(v, Math.min(l.need, l.onhand))) }
          : l
      )
    );

  const totalIssue = lines.reduce((s, l) => s + l.issue, 0);

  const save = () => {
    if (totalIssue === 0) {
      push({ kind: "warning", title: "ยังไม่ได้ระบุจำนวนจ่ายออก" });
      return;
    }
    push({
      kind: "success",
      title: `บันทึกการจ่ายออกแล้ว ${totalIssue} ชิ้น`,
      desc: "ระบบสาธิต — ไม่ตัดสต๊อกจริง",
    });
  };

  return (
    <>
      <PageHeader
        title="ตัดจ่ายอะไหล่"
        description="Stock Module » จ่ายอะไหล่ — สร้างเอกสารจ่ายออกตามงานซ่อม / ใบสั่งขาย"
      />

      {/* document header */}
      <div className="surface p-4">
        <FieldGrid cols={2}>
          <Field label="หมายเลขเอกสาร">
            <ReadOnly>
              <span className="font-medium text-primary">Generate Auto</span>
            </ReadOnly>
          </Field>
          <Field label="วันที่สร้างเอกสาร">
            <ReadOnly>
              <span className="num">{docDate || "—"}</span>
            </ReadOnly>
          </Field>
          <Field label="ประเภทเอกสาร" required>
            <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="อ้างอิงเลขเอกสาร" required>
            <div className="flex gap-2">
              <Select
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                className="flex-1"
              >
                <option value="">- - Please Select - -</option>
                {refOptions.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
              <Button size="md" variant="outline" onClick={getData}>
                <Search className="h-3.5 w-3.5" />
                Get Data
              </Button>
            </div>
          </Field>
        </FieldGrid>
      </div>

      {/* items table */}
      <div className="surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-3 py-2.5 text-center">#</th>
                <th className="px-3 py-2.5 text-left">Document No.</th>
                <th className="px-3 py-2.5 text-left">Item Code</th>
                <th className="px-3 py-2.5 text-left">Item Name</th>
                <th className="px-3 py-2.5 text-left">สถานะการเบิก</th>
                <th className="px-3 py-2.5 text-right">คงเหลือ</th>
                <th className="px-3 py-2.5 text-right">ต้องการ</th>
                <th className="px-3 py-2.5 text-right">จำนวนจ่ายออก</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-10 text-center text-sm text-danger/80"
                  >
                    {loaded ? "ไม่มีรายการข้อมูล" : "เลือกเอกสารอ้างอิงแล้วกด Get Data เพื่อดึงรายการ"}
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => (
                  <tr
                    key={l.code}
                    className="border-b border-border/70 last:border-0 hover:bg-accent/50"
                  >
                    <td className="num px-3 py-2 text-center text-muted-foreground">{i + 1}</td>
                    <td className="num px-3 py-2">{l.docNo}</td>
                    <td className="num px-3 py-2 font-medium">{l.code}</td>
                    <td className="px-3 py-2">
                      <span className="line-clamp-1 max-w-[320px]">{l.name}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={l.pickStatus === "รออะไหล่" ? "danger" : "warning"} dot>
                        {l.pickStatus}
                      </Badge>
                    </td>
                    <td
                      className={cn(
                        "num px-3 py-2 text-right font-medium",
                        l.onhand === 0 ? "text-danger" : l.onhand <= 3 ? "text-warning" : ""
                      )}
                    >
                      {int(l.onhand)}
                    </td>
                    <td className="num px-3 py-2 text-right">{int(l.need)}</td>
                    <td className="px-3 py-2">
                      <NumberInput
                        min={0}
                        max={Math.min(l.need, l.onhand)}
                        placeholder="0"
                        value={l.issue}
                        disabled={l.onhand === 0}
                        onChange={(n) => setIssue(l.code, n)}
                        className="ml-auto h-8 w-24"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {lines.length > 0 && (
          <div className="flex justify-end gap-3 border-t border-border px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">รวมจำนวนจ่ายออก</span>
            <span className="num font-semibold text-primary">{int(totalIssue)} ชิ้น</span>
          </div>
        )}
      </div>

      {/* footer */}
      <div className="surface p-4">
        <FieldGrid cols={2}>
          <Field label="จ่ายให้" required>
            <Select value={payTo} onChange={(e) => setPayTo(e.target.value)}>
              <option value="">- - Please Select - -</option>
              {RECIPIENTS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label="หมายเหตุ" wide>
            <Input
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="หมายเหตุการจ่ายออก…"
            />
          </Field>
        </FieldGrid>
      </div>

      <div className="flex justify-end">
        <Button size="md" onClick={save} disabled={lines.length === 0}>
          <Save className="h-4 w-4" />
          บันทึกการจ่ายออก
        </Button>
      </div>
    </>
  );
}
