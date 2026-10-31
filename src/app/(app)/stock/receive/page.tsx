'use client';

import * as React from 'react';
import { PackagePlus, Save, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Section } from '@/components/shared/section';
import { ProductPicker } from '@/components/shared/product-picker';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGrid } from '@/components/ui/field';
import { Input, Select, Textarea, NumberInput } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { int } from '@/lib/utils';
import { postJson, errMsg } from '@/lib/api';
import { useAccess } from '@/lib/use-access';
import { addDays, today } from '@/lib/dates';
import { useClearOnChange, useFormErrors } from '@/lib/use-form-errors';
import { receiveSchema } from '@/lib/validation/stock';
import { useTourRestore } from '@/components/tour/tour';

/** a receipt line: a part picked with the server search (never the whole catalog) and its quantity */
type Row = { sysCode: string; name: string; status: string; onhand: number; qty: number };

export default function ReceivePage() {
  const { push } = useToast();
  const fe = useFormErrors();
  const { name: me } = useAccess();
  const [rows, setRows] = React.useState<Row[]>([]);
  /** a picked part → a line (once; picked again = its quantity + 1). INACTIVE parts are still received */
  const addRow = (p: { sysCode: string; name: string; status: string; onhand: number }) =>
    setRows((s) =>
      s.some((r) => r.sysCode === p.sysCode)
        ? s.map((r) => (r.sysCode === p.sysCode ? { ...r, qty: r.qty + 1 } : r))
        : [...s, { ...p, qty: 1 }],
    );
  const [po, setPo] = React.useState('');
  const [date, setDate] = React.useState(today); // Thai calendar — identical on the server and in the browser
  const [supplier, setSupplier] = React.useState('');
  const [remark, setRemark] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  useTourRestore(
    () => ({
      po,
      date,
      supplier,
      remark,
      qty: Object.fromEntries(rows.filter((r) => r.qty > 0).map((r) => [r.sysCode, r.qty])),
    }),
    (v) => {
      setPo(v.po);
      setDate(v.date);
      setSupplier(v.supplier);
      setRemark(v.remark);
      setRows((s) => s.filter((r) => r.sysCode in v.qty).map((r) => ({ ...r, qty: v.qty[r.sysCode] ?? 0 })));
    },
  );

  const typedQty = rows.reduce((n, r) => n + r.qty, 0);
  useClearOnChange(fe.clear, { lines: typedQty, date });

  const save = async () => {
    const lines = rows.filter((r) => r.qty > 0).map((r) => ({ code: r.sysCode, qty: r.qty }));
    const body = { date, poRef: po, supplier, remark, lines };
    // the API's rules (lib/validation/stock); the lines message names what this screen asks for
    const e = { ...fe.run(receiveSchema, body) };
    if (!lines.length) e.lines = 'ต้องระบุจำนวนรับเข้าอย่างน้อย 1 รายการ';
    fe.setErrors(e);
    if (fe.report(e)) return;
    setSaving(true);
    try {
      const d = await postJson<{ no: string; total: number }>('/api/stock/receive', body);
      push({ kind: 'success', title: 'บันทึกการรับเข้าแล้ว', desc: `${d.no} · รวม ${int(d.total)} ชิ้น` });
      setPo('');
      setSupplier('');
      setRemark('');
      setRows([]);
    } catch (e) {
      if (!fe.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const setQty = (code: string, v: number) =>
    setRows((s) => s.map((r) => (r.sysCode === code ? { ...r, qty: Math.max(0, v) } : r)));

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalLines = rows.filter((r) => r.qty > 0).length;

  const columns: Column<Row>[] = [
    {
      key: 'no',
      header: '#',
      width: '52px',
      align: 'center',
      sortable: false,
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: 'sysCode',
      header: 'Item Code',
      width: '110px',
      cell: (r) => <span className="num font-medium">{r.sysCode}</span>,
    },
    {
      key: 'name',
      header: 'Item Name',
      cell: (r) => <span className="line-clamp-2 max-w-[420px]">{r.name}</span>,
    },
    {
      key: 'status',
      header: 'สถานะ',
      width: '100px',
      cell: (r) => (
        <Badge tone={r.status === 'Active' ? 'success' : 'neutral'} dot>
          {r.status === 'Active' ? r.status : 'ปิดใช้งาน'}
        </Badge>
      ),
    },
    {
      key: 'onhand',
      header: 'คงเหลือ',
      align: 'right',
      width: '90px',
      value: (r) => r.onhand,
      cell: (r) => int(r.onhand),
    },
    {
      key: 'qty',
      header: 'จำนวนรับเข้า',
      align: 'right',
      width: '140px',
      sortable: false,
      cell: (r) => (
        <NumberInput
          aria-label={`จำนวนรับเข้า ${r.sysCode}`}
          min={0}
          placeholder="0"
          value={r.qty}
          onChange={(n) => setQty(r.sysCode, n)}
          className="h-8 w-24"
        />
      ),
    },
    {
      key: 'remove',
      header: '',
      width: '52px',
      align: 'center',
      sortable: false,
      cell: (r) => (
        <button
          type="button"
          onClick={() => setRows((s) => s.filter((x) => x.sysCode !== r.sysCode))}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
          aria-label={`ลบ ${r.sysCode}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
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
          <Field label="อ้างอิงใบสั่งซื้อ (PO)" error={fe.errors.poRef}>
            <Input
              placeholder="PO2600000"
              maxLength={50}
              value={po}
              onChange={(e) => {
                setPo(e.target.value.toUpperCase());
                fe.clear('poRef');
              }}
            />
          </Field>
          <Field label="วันที่รับเข้า" required error={fe.errors.date}>
            <Input
              type="date"
              min={addDays(today(), -365)}
              max={today()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="รับเข้าคลัง" required>
            <Select defaultValue="คลังสินค้าดี">
              <option>คลังสินค้าดี</option>
            </Select>
          </Field>
          {/* supplier + remark share one 100-char column — the counters show the room left (nothing is cut) */}
          <Field label="ผู้จัดส่ง / Supplier" error={fe.errors.supplier} hint={`${supplier.length}/40 ตัวอักษร`}>
            <Input
              placeholder="ชื่อผู้จัดส่ง"
              maxLength={40}
              value={supplier}
              onChange={(e) => {
                setSupplier(e.target.value);
                fe.clear('supplier');
              }}
            />
          </Field>
          <Field label="รับเข้าโดย">
            <Input readOnly value={me || '—'} />
          </Field>
          <Field label="หมายเหตุ" wide error={fe.errors.remark} hint={`${remark.length}/47 ตัวอักษร`}>
            <Textarea
              rows={2}
              maxLength={47}
              placeholder="รายละเอียดเพิ่มเติม เช่น เลข Lot, สภาพสินค้า"
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                fe.clear('remark');
              }}
            />
          </Field>
        </FieldGrid>
      </Section>

      {fe.errors.lines && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          {fe.errors.lines}
        </p>
      )}
      <DataTable
        label="รายการรับเข้า"
        searchable={false}
        toolbar={
          <div className="w-96 max-w-full">
            <ProductPicker
              id="receive-product"
              inactive
              placeholder="ค้นหาอะไหล่ที่รับเข้า (รหัส / ชื่อ / เลข part)…"
              onPick={(p) =>
                p?.product &&
                addRow({
                  sysCode: p.code,
                  name: p.name,
                  // the lite row carries its status (an INACTIVE part is still received — shown as ปิดใช้งาน)
                  status: (p.product as { status?: string }).status ?? 'Active',
                  onhand: p.product.onhand,
                })
              }
            />
          </div>
        }
        columns={columns}
        rows={rows}
        rowKey={(r) => r.sysCode}
        emptyText="ค้นหาอะไหล่ที่ช่องด้านบนเพื่อเพิ่มรายการรับเข้า"
        footerNote={
          <span className="font-medium text-foreground">
            · รวมรับเข้า {int(totalQty)} ชิ้น ({totalLines} รายการ)
          </span>
        }
      />
    </>
  );
}
