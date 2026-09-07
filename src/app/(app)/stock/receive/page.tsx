"use client";

import * as React from "react";
import { PackagePlus, Save } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Section } from "@/components/shared/section";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Select, Textarea, NumberInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useProducts } from "@/data/db";
import { int } from "@/lib/utils";

type Row = {
  sysCode: string;
  name: string;
  status: string;
  onhand: number;
  qty: number;
};

export default function ReceivePage() {
  const { push } = useToast();
  const { data: PRODUCTS, loading } = useProducts();
  const [rows, setRows] = React.useState<Row[]>([]);

  React.useEffect(() => {
    setRows(
      PRODUCTS.slice(0, 6).map((p) => ({
        sysCode: p.sysCode,
        name: p.name,
        status: p.status,
        onhand: p.onhand,
        qty: 0,
      }))
    );
  }, [PRODUCTS]);

  const setQty = (code: string, v: number) =>
    setRows((s) => s.map((r) => (r.sysCode === code ? { ...r, qty: Math.max(0, v) } : r)));

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);

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
          <Button
            size="sm"
            onClick={() =>
              push({
                kind: totalQty > 0 ? "success" : "warning",
                title: totalQty > 0 ? "บันทึกการรับเข้าแล้ว" : "ยังไม่ได้ระบุจำนวนรับเข้า",
                desc: totalQty > 0 ? `รวม ${int(totalQty)} ชิ้น` : undefined,
              })
            }
          >
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
          <Field label="อ้างอิงใบสั่งซื้อ (PO)" required>
            <Input placeholder="PO2600000" />
          </Field>
          <Field label="วันที่รับเข้า" required>
            <Input type="date" defaultValue="2026-09-04" />
          </Field>
          <Field label="รับเข้าคลัง" required>
            <Select>
              <option>คลังกลาง</option>
              <option>ศูนย์ซ่อม รังสิต</option>
              <option>ศูนย์ซ่อม บางนา</option>
            </Select>
          </Field>
          <Field label="ผู้จัดส่ง / Supplier">
            <Input placeholder="ชื่อผู้จัดส่ง" />
          </Field>
          <Field label="รับเข้าโดย">
            <Input readOnly value="May - Pradit" />
          </Field>
          <Field label="หมายเหตุ" wide>
            <Textarea rows={2} placeholder="รายละเอียดเพิ่มเติม เช่น เลข Lot, สภาพสินค้า" />
          </Field>
        </FieldGrid>
      </Section>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.sysCode}
        searchPlaceholder="ค้นหารายการอะไหล่…"
        footerNote={
          <span className="font-medium text-foreground">
            · รวมรับเข้า {int(totalQty)} ชิ้น
          </span>
        }
      />
    </>
  );
}
