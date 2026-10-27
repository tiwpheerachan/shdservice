'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Printer } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { RowActions } from '@/components/shared/row-actions';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { WARRANTY_OPTIONS, QUOTATION_STATUS_OPTIONS } from '@/data/options';
import type { Quotation } from '@/data/types';
import { useQuotationsPage, useManufacturers, useQuotationStatuses } from '@/data/db';
import { baht } from '@/lib/utils';
import { useServerTable } from '@/lib/use-server-table';
import { useAccess } from '@/lib/use-access';
import { exportXlsx } from '@/lib/api';
import { cleanCode } from '@/lib/validation';
import { brandModelColumn, COL_MIN_WIDTH, DateTimeCell } from '@/components/shared/table-columns';
import { ExportButton } from '@/components/shared/export-button';
import { QUOTATION_TONE as TONE } from '@/components/shared/quotation-form';

type Filters = {
  no: string;
  type: string;
  customer: string;
  customerCode: string;
  jobNo: string;
  imei: string;
  warranty: string;
  brand: string;
  from: string;
  to: string;
  status: string;
};
const NO_FILTER: Filters = {
  no: '',
  type: '',
  customer: '',
  customerCode: '',
  jobNo: '',
  imei: '',
  warranty: '',
  brand: '',
  from: '',
  to: '',
  status: '',
};

export default function QuotationListPage() {
  const { add: canAdd, edit: canEdit } = useAccess().forPath('/quotation/list');
  const { data: MANUFACTURERS, ...brandsLookup } = useManufacturers();
  // every status in quotation_status (the fixed list is only the fallback while it loads)
  const { data: STATUSES } = useQuotationStatuses();
  const { draft, setD, filters, apply, reset, narrowed, table, pageArgs, server } = useServerTable(NO_FILTER);
  // each box its own condition (ANDed); the list, the export and the report KPI read them alike (quotationFiltersFromQuery)
  const query = { ...filters, jobNo: cleanCode(filters.jobNo) };
  const {
    rows: PAGE,
    total: totalRows,
    loading,
    error: loadError,
    refetch: retryLoad,
  } = useQuotationsPage({ ...pageArgs, ...query });
  const QUOTATIONS = PAGE;

  const columns: Column<Quotation>[] = [
    {
      key: 'no',
      header: 'หมายเลขใบเสนอราคา',
      headerWrap: true,
      width: '150px',
      cell: (r) => (
        <Link
          href={`/quotation/edit?no=${encodeURIComponent(r.no)}`}
          className="num font-medium text-primary hover:underline"
        >
          {r.no}
        </Link>
      ),
    },
    {
      key: 'date',
      header: 'วันที่',
      width: '110px',
      cell: (r) => <DateTimeCell value={r.date} />,
    },
    {
      key: 'type',
      header: 'ประเภท',
      width: '130px',
      hideBelow: 'xl',
      cell: (r) => <Badge tone={r.type.includes('VIP') ? 'primary' : 'neutral'}>{r.type}</Badge>,
    },
    {
      key: 'customer',
      header: 'ลูกค้า',
      minWidth: COL_MIN_WIDTH.customer,
      cell: (r) => (
        <span className="line-clamp-1 max-w-[220px]" title={r.customer}>
          {r.customer}
        </span>
      ),
    },
    {
      key: 'jobRef',
      header: 'อ้างถึงงานซ่อม',
      headerWrap: true,
      width: '130px',
      hideBelow: 'lg', // beside the sidebar at 1024–1279 it pushed สถานะ / Action off the table
      cell: (r) => <span className="num text-xs">{r.jobRef}</span>,
    },
    {
      key: 'imei',
      header: 'IMEI No.',
      headerWrap: true,
      hideBelow: 'xl',
      cell: (r) => <span className="num text-xs">{r.imei}</span>,
    },
    brandModelColumn(),
    {
      key: 'amount',
      header: 'จำนวนเงิน',
      align: 'right',
      width: '120px',
      value: (r) => r.amount,
      cell: (r) => <span className="font-medium">{baht(r.amount)}</span>,
    },
    {
      key: 'approveDate',
      header: 'วันที่ตอบรับ',
      headerWrap: true,
      hideBelow: 'xl',
      width: '130px',
      cell: (r) => <DateTimeCell value={r.approveDate} />,
    },
    {
      key: 'status',
      header: 'สถานะ',
      width: '140px',
      // the server's status: sent but past its validity already reads พ้นกำหนดเสนอราคา (src/lib/quote-expiry.ts)
      cell: (r) => (
        <Badge tone={TONE[r.status] ?? 'neutral'} dot>
          {r.status}
        </Badge>
      ),
    },
    {
      key: 'action',
      header: 'จัดการ',
      width: '110px',
      align: 'center',
      sortable: false,
      cell: (r) => (
        <RowActions
          viewHref={`/quotation/edit?no=${encodeURIComponent(r.no)}`}
          editHref={canEdit ? `/quotation/edit?no=${encodeURIComponent(r.no)}` : undefined}
        />
      ),
    },
  ];

  const total = QUOTATIONS.reduce((s, q) => s + q.amount, 0);

  return (
    <>
      <PageHeader
        title="รายการใบเสนอราคา"
        description="ข้อมูลใบเสนอราคา » ข้อมูลใบเสนอราคาทั้งหมด"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              พิมพ์
            </Button>
            <ExportButton run={() => exportXlsx('quotations', { ...query, q: table.q })} />
            {canAdd && (
              <Link href="/quotation/new">
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  สร้างใบเสนอราคา
                </Button>
              </Link>
            )}
          </>
        }
      />

      <FilterBar onSearch={apply} onReset={reset}>
        <Field label="หมายเลขใบเสนอราคา">
          <Input className="num" placeholder="Q2600462" value={draft.no} onChange={(e) => setD('no', e.target.value)} />
        </Field>
        <Field label="ประเภท">
          <Select value={draft.type} onChange={(e) => setD('type', e.target.value)}>
            <option value="">ทั้งหมด</option>
            <option>Type A (Normal)</option>
            <option>Type B (VIP)</option>
          </Select>
        </Field>
        <Field label="ชื่อ-สกุลลูกค้า">
          <Input value={draft.customer} onChange={(e) => setD('customer', e.target.value)} />
        </Field>
        <Field label="รหัสลูกค้า">
          <Input className="num" value={draft.customerCode} onChange={(e) => setD('customerCode', e.target.value)} />
        </Field>
        <Field label="หมายเลขงานซ่อม">
          <Input className="num" value={draft.jobNo} onChange={(e) => setD('jobNo', e.target.value)} />
        </Field>
        <Field label="IMEI No.">
          <Input className="num" value={draft.imei} onChange={(e) => setD('imei', e.target.value)} />
        </Field>
        <Field label="Warranty">
          <Select value={draft.warranty} onChange={(e) => setD('warranty', e.target.value)}>
            <option value="">ทั้งหมด</option>
            {WARRANTY_OPTIONS.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </Select>
        </Field>
        <Field label="ยี่ห้อ" lookup={brandsLookup}>
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.brand}
            onChange={(v) => setD('brand', v)}
            options={MANUFACTURERS.map((m) => ({ value: m.name, label: m.name }))}
            searchPlaceholder="พิมพ์ชื่อยี่ห้อ…"
          />
        </Field>
        <Field label="วันที่สร้าง (ตั้งแต่)">
          <Input type="date" value={draft.from} onChange={(e) => setD('from', e.target.value)} />
        </Field>
        <Field label="วันที่สร้าง (ถึง)">
          <Input type="date" value={draft.to} onChange={(e) => setD('to', e.target.value)} />
        </Field>
        <Field label="สถานะใบเสนอราคา">
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.status}
            onChange={(v) => setD('status', v)}
            options={strOptions(STATUSES.length ? STATUSES.map((x) => x.name) : QUOTATION_STATUS_OPTIONS)}
          />
        </Field>
      </FilterBar>

      <DataTable
        narrowed={narrowed}
        onClearFilters={reset}
        searchable={false}
        columns={columns}
        rows={QUOTATIONS}
        loading={loading}
        error={loadError}
        onRetry={retryLoad}
        rowKey={(r) => r.no}
        footerNote={<span className="font-medium text-foreground">· มูลค่ารวม (หน้านี้) {baht(total)} ฿</span>}
        server={{ ...server, total: totalRows }}
      />
    </>
  );
}
