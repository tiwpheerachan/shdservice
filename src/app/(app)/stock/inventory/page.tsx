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
import { useMovements, useProducts } from "@/data/db";
import { int } from "@/lib/utils";

const DOC_TYPES = STOCK_MOVE_TYPES;

function typeTone(type: string): Tone {
  if (/รับเข้า|รับคืน/.test(type)) return "success";
  if (/จ่าย|เบิก/.test(type)) return "warning";
  if (/โอน/.test(type)) return "info";
  return "neutral";
}

export default function InventoryPage() {
  const { push } = useToast();
  const { data: MOVEMENTS, loading } = useMovements();
  const { data: PRODUCTS } = useProducts();

  const [viewDoc, setViewDoc] = React.useState<Movement | null>(null);

  // demo line items for the selected document
  const lines = viewDoc
    ? PRODUCTS.slice(0, 2).map((p) => ({
        code: p.sysCode,
        name: p.name,
        supplier: "",
        lot: "",
        inv: "",
        qty: 1,
        unit: "Pcs.",
      }))
    : [];
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
        onSearch={() => push({ kind: "info", title: "ค้นหาข้อมูลแล้ว" })}
        onReset={() => push({ kind: "info", title: "แสดงข้อมูลทั้งหมด" })}
      >
        <Field label="วันที่สร้างเอกสาร (ตั้งแต่)">
          <Input type="date" defaultValue="2026-08-05" />
        </Field>
        <Field label="วันที่สร้างเอกสาร (ถึง)">
          <Input type="date" defaultValue="2026-09-07" />
        </Field>
        <Field label="ประเภทเอกสาร">
          <Select>
            <option>- - Select All - -</option>
            {DOC_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="คลังสินค้า">
          <Select>
            <option>- - Select All - -</option>
            {WAREHOUSES.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </Select>
        </Field>
        <Field label="รหัสอะไหล่">
          <Input placeholder="P02534" className="num" />
        </Field>
        <Field label="หมายเลขเอกสาร">
          <Input placeholder="WHO2602139" className="num" />
        </Field>
        <Field label="อ้างอิงเอกสาร">
          <Input placeholder="J2611143 / SO2600730" className="num" />
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
                        <td className="px-3 py-2 text-muted-foreground">{l.lot || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{l.inv || "—"}</td>
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
