"use client";

import * as React from "react";
import { PackageMinus, Save, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, NumberInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useProducts, useJobNos, useSaleOrders, useStaff } from "@/data/db";
import { STOCK_PICK_TYPES } from "@/data/mock";
import { int, cn } from "@/lib/utils";
import { api, postJson, errMsg, qs } from "@/lib/api";

const DOC_TYPES = STOCK_PICK_TYPES; // = inventory_type 3 / 4 / 5

type Line = {
  docNo: string;
  code: string;
  name: string;
  pickStatus: string;
  onhand: number;
  need: number;
  issue: number;
  logId?: number; // job_order_spare_part_log id (จ่ายออกตามงานซ่อม)
  dtId?: number; // sale_out_dt id (จ่ายออกตามใบสั่งขาย)
};

type PartLine = { logId: number; jobNo: string; code: string; name: string; onhand: number; need: number; status: string };
type SoLine = { dtId: number; code: string; name: string; onhand: number; need: number; picked: boolean };

export default function PickPage() {
  const { push } = useToast();
  const { data: PRODUCTS, refetch: refetchProducts } = useProducts();
  const { data: JOB_NOS } = useJobNos(100);
  const { data: SALE_ORDERS } = useSaleOrders({ approve: "อนุมัติแล้ว", limit: 100 });
  const { data: STAFF } = useStaff();
  const [saving, setSaving] = React.useState(false);

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

  const kind: "job" | "sale" | "other" =
    docType === "จ่ายออกตามงานซ่อม" ? "job" : docType === "จ่ายออกตามใบสั่งขาย" ? "sale" : "other";
  // อ้างอิง: งานที่ยังไม่ปิด / ใบสั่งขายที่รอจ่าย / (อื่นๆ ไม่ต้องอ้างอิง)
  const refOptions = kind === "job" ? JOB_NOS : kind === "sale" ? SALE_ORDERS.map((s) => s.no) : [];
  const RECIPIENTS = React.useMemo(
    () => ["คลังสินค้าดี", ...STAFF.map((s) => s.name)],
    [STAFF]
  );

  React.useEffect(() => {
    setRef("");
    setLines([]);
    setLoaded(false);
  }, [docType]);

  // ดึงรายการค้างจ่ายของเอกสารอ้างอิงจาก DB
  const getData = async () => {
    if (kind === "other") {
      // จ่ายออกอื่นๆ: เลือกจากรายการอะไหล่ทั้งหมด (ใส่จำนวนเฉพาะที่ต้องการจ่าย)
      setLines(
        PRODUCTS.filter((p) => p.onhand > 0).map((p) => ({
          docNo: "-",
          code: p.sysCode,
          name: p.name,
          pickStatus: "พร้อมจ่าย",
          onhand: p.onhand,
          need: p.onhand,
          issue: 0,
        }))
      );
      setLoaded(true);
      return;
    }
    if (!ref) {
      push({ kind: "warning", title: "กรุณาเลือกอ้างอิงเลขเอกสารก่อน" });
      return;
    }
    try {
      if (kind === "job") {
        const d = await api<{ rows: PartLine[] }>(`/api/stock/pick-lines${qs({ type: "job", ref })}`);
        setLines(
          d.rows.map((r) => ({
            docNo: r.jobNo,
            code: r.code,
            name: r.name,
            pickStatus: r.status,
            onhand: r.onhand,
            need: r.need,
            issue: 0,
            logId: r.logId,
          }))
        );
        setLoaded(true);
        push({ kind: "success", title: "ดึงรายการเบิกแล้ว", desc: `${ref} — ${d.rows.length} รายการ` });
      } else {
        const d = await api<{ rows: SoLine[] }>(`/api/stock/pick-lines${qs({ type: "sale", ref })}`);
        const rows = d.rows.filter((r) => !r.picked);
        setLines(
          rows.map((r) => ({
            docNo: ref,
            code: r.code,
            name: r.name,
            pickStatus: r.onhand === 0 ? "รออะไหล่" : "รอจ่าย",
            onhand: r.onhand,
            need: r.need,
            issue: 0,
            dtId: r.dtId,
          }))
        );
        setLoaded(true);
        push({ kind: "success", title: "ดึงรายการแล้ว", desc: `${ref} — ${rows.length} รายการ` });
      }
    } catch (e) {
      push({ kind: "error", title: "ดึงรายการไม่สำเร็จ", desc: errMsg(e) });
    }
  };

  const setIssue = (key: number | string, v: number) =>
    setLines((s) =>
      s.map((l) =>
        (l.logId ?? l.dtId ?? l.code) === key
          ? { ...l, issue: Math.max(0, Math.min(v, Math.min(l.need, l.onhand))) }
          : l
      )
    );

  const totalIssue = lines.reduce((s, l) => s + l.issue, 0);

  // WHO document (type 3/4/5) → inventory_hd/dt + quantity_used/remain (+ grant on ใบเบิก)
  const save = async () => {
    if (totalIssue === 0) {
      push({ kind: "warning", title: "ยังไม่ได้ระบุจำนวนจ่ายออก" });
      return;
    }
    if (!payTo) {
      push({ kind: "warning", title: "กรุณาระบุ จ่ายให้" });
      return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ no: string; total: number }>("/api/stock/issue", {
        type: kind,
        ref,
        payTo,
        remark,
        lines: lines.filter((l) => l.issue > 0).map((l) => ({ logId: l.logId, dtId: l.dtId, code: l.code, qty: l.issue })),
      });
      push({ kind: "success", title: `บันทึกการจ่ายออกแล้ว ${d.total} ชิ้น`, desc: d.no });
      setLines([]);
      setLoaded(false);
      setRef("");
      setRemark("");
      refetchProducts();
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
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
          <Field label="อ้างอิงเลขเอกสาร" required={kind !== "other"}>
            <div className="flex gap-2">
              <Select
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                className="flex-1"
                disabled={kind === "other"}
              >
                <option value="">{kind === "other" ? "- - ไม่ต้องอ้างอิง - -" : "- - Please Select - -"}</option>
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
                    key={l.logId ?? l.dtId ?? l.code}
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
                        onChange={(n) => setIssue(l.logId ?? l.dtId ?? l.code, n)}
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
        <Button size="md" onClick={save} disabled={lines.length === 0 || saving}>
          <Save className="h-4 w-4" />
          บันทึกการจ่ายออก
        </Button>
      </div>
    </>
  );
}
