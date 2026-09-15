"use client";

import * as React from "react";
import { Download, Eye } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type Movement, STOCK_MOVE_TYPES, WAREHOUSES } from "@/data/mock";
import { useMovements } from "@/data/db";
import { int } from "@/lib/utils";
import { api, errMsg } from "@/lib/api";

type LineRow = { code: string; name: string; qty: number; unit: string; supplier: string; ref: string };
type Filters = { from: string; to: string; type: string; warehouse: string; code: string; doc: string; ref: string };
const NO_FILTER: Filters = { from: "", to: "", type: "", warehouse: "", code: "", doc: "", ref: "" };

const DOC_TYPES = STOCK_MOVE_TYPES;

function typeTone(type: string): Tone {
  if (/รับเข้า|รับคืน/.test(type)) return "success";
  if (/จ่าย|เบิก/.test(type)) return "warning";
  if (/โอน/.test(type)) return "info";
  return "neutral";
}

export default function InventoryPage() {
  const { push } = useToast();
  const [draft, setDraft] = React.useState<Filters>(NO_FILTER);
  const [filters, setFilters] = React.useState<Filters>(NO_FILTER);
  const setD = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));
  // inventory_hd (latest 1,000 unless filtered) — filters run on the server
  const { data: ALL, loading } = useMovements({ from: filters.from, to: filters.to, type: filters.type, q: filters.code || filters.doc || filters.ref });
  const MOVEMENTS = React.useMemo(
    () =>
      ALL.filter(
        (m) =>
          (!filters.doc || m.doc.toLowerCase().includes(filters.doc.toLowerCase())) &&
          (!filters.ref || m.ref.toLowerCase().includes(filters.ref.toLowerCase())) &&
          (!filters.code || (m.items ?? "").toLowerCase().includes(filters.code.toLowerCase()))
      ),
    [ALL, filters]
  );

  const [viewDoc, setViewDoc] = React.useState<Movement | null>(null);
  const [lines, setLines] = React.useState<LineRow[]>([]);
  React.useEffect(() => {
    if (!viewDoc) return;
    let active = true;
    setLines([]);
    api<{ rows: LineRow[] }>(`/api/stock/movements/${encodeURIComponent(viewDoc.doc)}`)
      .then((d) => active && setLines(d.rows))
      .catch((e) => push({ kind: "error", title: "โหลดรายการไม่สำเร็จ", desc: errMsg(e) }));
    return () => {
      active = false;
    };
  }, [viewDoc, push]);
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  const columns: Column<Movement>[] = [
    {
      key: "no",
      header: "#",
      width: "52px",
      align: "center",
      sortable: false,
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: "doc",
      header: "Document No.",
      width: "130px",
      cell: (r) => <span className="num font-medium">{r.doc}</span>,
    },
    {
      key: "type",
      header: "ประเภทเอกสาร",
      cell: (r) => <Badge tone={typeTone(r.type)}>{r.type}</Badge>,
    },
    {
      key: "ref",
      header: "อ้างอิงถึง",
      width: "120px",
      cell: (r) => <span className="num text-primary">{r.ref || "—"}</span>,
    },
    {
      key: "date",
      header: "วันที่",
      width: "140px",
      cell: (r) => <span className="num text-xs">{r.date}</span>,
    },
    { key: "by", header: "โดย", hideBelow: "md" },
    { key: "from", header: "From-Location", hideBelow: "lg" },
    { key: "to", header: "To-Location", hideBelow: "lg" },
    {
      key: "remark",
      header: "Remark",
      hideBelow: "xl",
      cell: (r) => <span className="text-muted-foreground">{r.remark || "—"}</span>,
    },
    {
      key: "action",
      header: "Action",
      width: "90px",
      align: "center",
      sortable: false,
      cell: (r) => (
        <Button size="sm" variant="outline" onClick={() => setViewDoc(r)}>
          <Eye className="h-3.5 w-3.5" />
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="ประวัติการเคลื่อนไหวเข้า-ออก"
        description="Stock Module » ประวัติการเคลื่อนไหวเข้า-ออก ของอะไหล่ทั้งหมด"
        actions={
          <Button variant="outline" size="sm">
            <Download className="h-3.5 w-3.5" />
            ส่งออก Excel
          </Button>
        }
      />

      <FilterBar
        onSearch={() => {
          setFilters(draft);
          push({ kind: "info", title: "ค้นหาข้อมูลแล้ว" });
        }}
        onReset={() => {
          setDraft(NO_FILTER);
          setFilters(NO_FILTER);
          push({ kind: "info", title: "แสดงข้อมูลทั้งหมด" });
        }}
      >
        <Field label="วันที่สร้างเอกสาร (ตั้งแต่)">
          <Input type="date" value={draft.from} onChange={(e) => setD("from", e.target.value)} />
        </Field>
        <Field label="วันที่สร้างเอกสาร (ถึง)">
          <Input type="date" value={draft.to} onChange={(e) => setD("to", e.target.value)} />
        </Field>
        <Field label="ประเภทเอกสาร">
          <Select value={draft.type} onChange={(e) => setD("type", e.target.value)}>
            <option value="">- - Select All - -</option>
            {DOC_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="คลังสินค้า">
          <Select value={draft.warehouse} onChange={(e) => setD("warehouse", e.target.value)}>
            <option value="">- - Select All - -</option>
            {WAREHOUSES.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </Select>
        </Field>
        <Field label="รหัสอะไหล่">
          <Input placeholder="P02534" className="num" value={draft.code} onChange={(e) => setD("code", e.target.value)} />
        </Field>
        <Field label="หมายเลขเอกสาร">
          <Input placeholder="WHO2602139" className="num" value={draft.doc} onChange={(e) => setD("doc", e.target.value)} />
        </Field>
        <Field label="อ้างอิงเอกสาร">
          <Input placeholder="J2611143 / SO2600730" className="num" value={draft.ref} onChange={(e) => setD("ref", e.target.value)} />
        </Field>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={MOVEMENTS}
        loading={loading}
        rowKey={(r) => r.doc}
        searchPlaceholder="ค้นหาเอกสาร / ผู้ทำรายการ…"
      />

      {/* document line-items modal */}
      <Modal
        open={!!viewDoc}
        onClose={() => setViewDoc(null)}
        size="xl"
        title="รายละเอียดเอกสารเคลื่อนไหว"
        description={
          viewDoc ? `${viewDoc.doc} · ${viewDoc.type}` : undefined
        }
        footer={
          <Button variant="outline" size="sm" onClick={() => setViewDoc(null)}>
            ปิด
          </Button>
        }
      >
        {viewDoc && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="table-scroll">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                      <th className="w-10 px-3 py-2 text-center">#</th>
                      <th className="px-3 py-2 text-left">Document No.</th>
                      <th className="px-3 py-2 text-left">รหัส</th>
                      <th className="px-3 py-2 text-left">ชื่อ</th>
                      <th className="px-3 py-2 text-left">Supplier</th>
                      <th className="px-3 py-2 text-left">LotNo.</th>
                      <th className="px-3 py-2 text-left">InvNo.</th>
                      <th className="px-3 py-2 text-right">จำนวน</th>
                      <th className="px-3 py-2 text-left">หน่วย</th>
                      <th className="px-3 py-2 text-left">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.code} className="border-b border-border/70 last:border-0">
                        <td className="num px-3 py-2 text-center text-muted-foreground">{i + 1}</td>
                        <td className="num px-3 py-2">{viewDoc.doc}</td>
                        <td className="num px-3 py-2 font-medium">{l.code}</td>
                        <td className="px-3 py-2">
                          <span className="line-clamp-1 max-w-[320px]">{l.name}</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{l.supplier || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">—</td>
                        <td className="px-3 py-2 text-muted-foreground">{l.ref || "—"}</td>
                        <td className="num px-3 py-2 text-right">{int(l.qty)}</td>
                        <td className="px-3 py-2">{l.unit}</td>
                        <td className="px-3 py-2 text-muted-foreground">—</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/60 font-semibold">
                      <td colSpan={7} className="px-3 py-2 text-right">
                        Total
                      </td>
                      <td className="num px-3 py-2 text-right text-primary">{int(totalQty)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              หมายเหตุ: {viewDoc.remark || "—"}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
