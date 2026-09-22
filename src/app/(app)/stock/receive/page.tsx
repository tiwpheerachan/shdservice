"use client";

import * as React from "react";
import { PackagePlus, Save } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Section } from "@/components/shared/section";
import { FilterBar } from "@/components/shared/filter-bar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Select, Textarea, NumberInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useProducts, useManufacturers, useCategories } from "@/data/db";
import { int } from "@/lib/utils";
import { postJson, errMsg } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

type Row = {
  sysCode: string;
  mfgCode: string;
  name: string;
  brand: string;
  category: string;
  status: string;
  onhand: number;
  qty: number;
};

export default function ReceivePage() {
  const { push } = useToast();
  const { name: me } = useAccess();
  const { data: PRODUCTS, loading, refetch } = useProducts();
  const { data: BRANDS } = useManufacturers();
  const { data: CATEGORIES } = useCategories();
  const [rows, setRows] = React.useState<Row[]>([]);
  // filter bar narrows which lines are SHOWN; quantities typed into hidden lines are kept
  // (the save reads `rows`, not the visible subset) and counted in the footer
  type LineFilter = { code: string; mfgCode: string; name: string; brand: string; category: string };
  const NO_FILTER: LineFilter = { code: "", mfgCode: "", name: "", brand: "", category: "" };
  const [draft, setDraft] = React.useState<LineFilter>(NO_FILTER);
  const [filter, setFilter] = React.useState<LineFilter>(NO_FILTER);
  const has = (v: string, t: string) => !t.trim() || v.toLowerCase().includes(t.trim().toLowerCase());
  const visible = React.useMemo(
    () =>
      rows.filter(
        (r) => has(r.sysCode, filter.code) && has(r.mfgCode, filter.mfgCode) && has(r.name, filter.name) && (!filter.brand || r.brand === filter.brand) && (!filter.category || r.category === filter.category)
      ),
    [rows, filter]
  );
  const [po, setPo] = React.useState("");
  const [date, setDate] = React.useState("");
  const [supplier, setSupplier] = React.useState("");
  const [remark, setRemark] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // today's date on the client only (avoids SSR/hydration mismatch)
  React.useEffect(() => {
    const n = new Date();
    const p = (x: number) => String(x).padStart(2, "0");
    setDate(`${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`);
  }, []);

  // every active part is a candidate line; use the table search to find one
  React.useEffect(() => {
    setRows(
      PRODUCTS.map((p) => ({
        sysCode: p.sysCode,
        mfgCode: p.mfgCode ?? "",
        name: p.name,
        brand: p.brand ?? "",
        category: p.category ?? "",
        status: p.status,
        onhand: p.onhand,
        qty: 0,
      }))
    );
  }, [PRODUCTS]);

  // WHI document: inventory_hd/dt + product_none_serial.quantity_available/remain
  const save = async () => {
    const lines = rows.filter((r) => r.qty > 0).map((r) => ({ code: r.sysCode, qty: r.qty }));
    if (!lines.length) {
      push({ kind: "warning", title: "ยังไม่ได้ระบุจำนวนรับเข้า" });
      return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ no: string; total: number }>("/api/stock/receive", { date, poRef: po, supplier, remark, lines });
      push({ kind: "success", title: "บันทึกการรับเข้าแล้ว", desc: `${d.no} · รวม ${int(d.total)} ชิ้น` });
      setPo("");
      setSupplier("");
      setRemark("");
      refetch();
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const setQty = (code: string, v: number) =>
    setRows((s) => s.map((r) => (r.sysCode === code ? { ...r, qty: Math.max(0, v) } : r)));

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalLines = rows.filter((r) => r.qty > 0).length;
  const hiddenLines = rows.filter((r) => r.qty > 0 && !visible.includes(r)).length;

  const columns: Column<Row>[] = [
    {
      key: "no",
      header: "#",
      width: "52px",
      align: "center",
      sortable: false,
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: "sysCode",
      header: "Item Code",
      width: "110px",
      cell: (r) => <span className="num font-medium">{r.sysCode}</span>,
    },
    {
      key: "name",
      header: "Item Name",
      cell: (r) => <span className="line-clamp-2 max-w-[420px]">{r.name}</span>,
    },
    {
      key: "status",
      header: "สถานะ",
      width: "100px",
      cell: (r) => <Badge tone="success" dot>{r.status}</Badge>,
    },
    {
      key: "onhand",
      header: "คงเหลือ",
      align: "right",
      width: "90px",
      value: (r) => r.onhand,
      cell: (r) => int(r.onhand),
    },
    {
      key: "qty",
      header: "จำนวนรับเข้า",
      align: "right",
      width: "140px",
      sortable: false,
      cell: (r) => (
        <NumberInput
          min={0}
          placeholder="0"
          value={r.qty}
          onChange={(n) => setQty(r.sysCode, n)}
          className="h-8 w-24"
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="รับเข้าอะไหล่"
        description="บันทึกการรับอะไหล่เข้าคลัง อ้างอิงใบสั่งซื้อหรือใบส่งของจากผู้ผลิต"
        actions={
          <Button size="sm" onClick={save} disabled={saving}>
            <Save className="h-3.5 w-3.5" />
            บันทึกการรับเข้า
          </Button>
        }
      />

      <Section title="ข้อมูลเอกสารรับเข้า" icon={PackagePlus}>
        <FieldGrid>
          <Field label="เลขที่เอกสารรับเข้า">
            <Input readOnly value="Generate Auto" />
          </Field>
          {/* ระบบเดิมไม่เคยบันทึก PO (reference_document_no ว่างทั้ง 6,309 ใบ) → ไม่บังคับ */}
          <Field label="อ้างอิงใบสั่งซื้อ (PO)">
            <Input placeholder="PO2600000" value={po} onChange={(e) => setPo(e.target.value)} />
          </Field>
          <Field label="วันที่รับเข้า" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="รับเข้าคลัง" required>
            <Select defaultValue="คลังสินค้าดี">
              <option>คลังสินค้าดี</option>
            </Select>
          </Field>
          <Field label="ผู้จัดส่ง / Supplier">
            <Input placeholder="ชื่อผู้จัดส่ง" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label="รับเข้าโดย">
            <Input readOnly value={me || "—"} />
          </Field>
          <Field label="หมายเหตุ" wide>
            <Textarea
              rows={2}
              placeholder="รายละเอียดเพิ่มเติม เช่น เลข Lot, สภาพสินค้า"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </Field>
        </FieldGrid>
      </Section>

      <FilterBar
        onSearch={() => setFilter(draft)}
        onReset={() => {
          setDraft(NO_FILTER);
          setFilter(NO_FILTER);
        }}
      >
        <Field label="รหัสอะไหล่ (ระบบ)">
          <Input placeholder="P00012" className="num" value={draft.code} onChange={(e) => setDraft((f) => ({ ...f, code: e.target.value }))} />
        </Field>
        <Field label="รหัสอะไหล่ (ผู้ผลิต)">
          <Input placeholder="เลข part" className="num" value={draft.mfgCode} onChange={(e) => setDraft((f) => ({ ...f, mfgCode: e.target.value }))} />
        </Field>
        <Field label="ชื่ออะไหล่">
          <Input placeholder="พิมพ์บางส่วนของชื่อ" value={draft.name} onChange={(e) => setDraft((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="ยี่ห้อ (ผู้ผลิต)">
          <Select value={draft.brand} onChange={(e) => setDraft((f) => ({ ...f, brand: e.target.value }))}>
            <option value="">ทั้งหมด</option>
            {BRANDS.map((b) => (
              <option key={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="หมวดหมู่">
          <Select value={draft.category} onChange={(e) => setDraft((f) => ({ ...f, category: e.target.value }))}>
            <option value="">ทั้งหมด</option>
            {CATEGORIES.map((c) => (
              <option key={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      <DataTable
        searchable={false}
        columns={columns}
        rows={visible}
        loading={loading}
        rowKey={(r) => r.sysCode}
        footerNote={
          <span className="font-medium text-foreground">
            · รวมรับเข้า {int(totalQty)} ชิ้น ({totalLines} รายการ{hiddenLines ? ` — ${hiddenLines} รายการอยู่นอกตัวกรอง` : ""})
          </span>
        }
      />
    </>
  );
}
