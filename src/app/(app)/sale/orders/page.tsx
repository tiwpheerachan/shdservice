'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { SearchSelect } from '@/components/shared/search-select';
import { RowActions } from '@/components/shared/row-actions';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import type { SaleOrder } from '@/data/types';
import { SO_TONE as TONE } from '@/components/shared/sale-order-form';
import { useSaleOrdersPage, useStaff } from '@/data/db';
import { baht } from '@/lib/utils';
import { useServerTable } from '@/lib/use-server-table';
import { useAccess } from '@/lib/use-access';
import { exportXlsx } from '@/lib/api';
import { ExportButton } from '@/components/shared/export-button';

type Filters = { no: string; customer: string; from: string; to: string; code: string; sales: string; approve: string };
const NO_FILTER: Filters = { no: '', customer: '', from: '', to: '', code: '', sales: '', approve: '' };
const WAITING = 'รออนุมัติ'; // approve_status 2 (its approve_name_th — the list filters by that name)

function SaleOrderList() {
  const { add: canAdd, edit: canEdit } = useAccess().forPath('/sale/orders');
  const { data: USERS, ...staffLookup } = useStaff('sales');
  const { draft, setDraft, setD, filters, setFilters, apply, reset, narrowed, table, pageArgs, server } =
    useServerTable(NO_FILTER);
  const showWaiting = () => {
    setDraft((f) => ({ ...f, approve: WAITING }));
    setFilters((f) => ({ ...f, approve: WAITING }));
  };
  // deep link /sale/orders?pending=1 (landing / bell) → รออนุมัติ only; read on every URL change, adjusted while
  // rendering (a link to this page from this page does not remount it)
  const pending = useSearchParams().get('pending') === '1';
  const [pendingSeen, setPendingSeen] = React.useState(false);
  if (pending !== pendingSeen) {
    setPendingSeen(pending);
    if (pending) showWaiting();
  }
  const {
    rows: SALE_ORDERS,
    total,
    loading,
    error: loadError,
    refetch: retryLoad,
  } = useSaleOrdersPage({
    ...pageArgs,
    no: filters.no,
    customer: filters.customer,
    code: filters.code,
    from: filters.from,
    to: filters.to,
    sales: filters.sales,
    approve: filters.approve,
  });

  const columns: Column<SaleOrder>[] = [
    {
      key: 'no',
      header: 'เลขใบสั่งขาย',
      width: '120px',
      cell: (r) => (
        <Link
          href={`/sale/orders/edit?no=${encodeURIComponent(r.no)}`}
          className="num font-medium text-primary hover:underline"
        >
          {r.no}
        </Link>
      ),
    },
    {
      key: 'date',
      header: 'วันที่สั่ง',
      width: '110px',
      cell: (r) => <span className="num text-xs">{r.date}</span>,
    },
    {
      key: 'customer',
      header: 'ชื่อลูกค้า',
      cell: (r) => <span className="line-clamp-1 max-w-[260px]">{r.customer}</span>,
    },
    {
      key: 'amount',
      header: 'จำนวนเงิน',
      align: 'right',
      width: '120px',
      value: (r) => r.amount,
      cell: (r) => <span className="font-medium">{baht(r.amount)}</span>,
    },
    { key: 'sales', header: 'พนักงานขาย', hideBelow: 'md' },
    {
      key: 'approve',
      header: 'สถานะอนุมัติ',
      width: '160px',
      cell: (r) => (
        <Badge tone={TONE[r.approve] ?? 'neutral'} dot>
          {r.approve}
        </Badge>
      ),
    },
    {
      key: 'stockDoc',
      header: 'เลขจ่ายสต๊อก',
      hideBelow: 'xl',
      cell: (r) => <span className="num text-xs">{r.stockDoc || '—'}</span>,
    },
    {
      key: 'tracking',
      header: 'เลขพัสดุ',
      hideBelow: 'xl',
      cell: (r) => <span className="num text-xs">{r.tracking || '—'}</span>,
    },
    {
      key: 'action',
      header: 'จัดการ',
      width: '110px',
      align: 'center',
      sortable: false,
      cell: (r) => (
        <RowActions
          viewHref={`/sale/orders/edit?no=${encodeURIComponent(r.no)}`}
          editHref={canEdit ? `/sale/orders/edit?no=${encodeURIComponent(r.no)}` : undefined}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="รายการใบสั่งขาย"
        description="เมนูขาย » ใบสั่งขาย (Sale Order)"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={showWaiting} aria-pressed={filters.approve === WAITING}>
              {WAITING}
            </Button>
            <ExportButton
              run={() =>
                exportXlsx('sale_orders', {
                  q: table.q,
                  no: filters.no,
                  customer: filters.customer,
                  code: filters.code,
                  from: filters.from,
                  to: filters.to,
                  sales: filters.sales,
                  approve: filters.approve,
                })
              }
            />
            {canAdd && (
              <Link href="/sale/orders/new">
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  สร้างใบสั่งขาย
                </Button>
              </Link>
            )}
          </>
        }
      />

      <FilterBar onSearch={apply} onReset={reset}>
        <Field label="เลขใบสั่งขาย (SO)">
          <Input
            className="num"
            placeholder="SO2600760"
            value={draft.no}
            onChange={(e) => setD('no', e.target.value)}
          />
        </Field>
        <Field label="ชื่อลูกค้า">
          <Input value={draft.customer} onChange={(e) => setD('customer', e.target.value)} />
        </Field>
        <Field label="วันที่สั่งขาย (ตั้งแต่)">
          <Input type="date" value={draft.from} onChange={(e) => setD('from', e.target.value)} />
        </Field>
        <Field label="วันที่สั่งขาย (ถึง)">
          <Input type="date" value={draft.to} onChange={(e) => setD('to', e.target.value)} />
        </Field>
        <Field label="รหัสอะไหล่-อุปกรณ์เสริม">
          <Input className="num" value={draft.code} onChange={(e) => setD('code', e.target.value)} />
        </Field>
        <Field label="พนักงานขาย" lookup={staffLookup}>
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.sales}
            onChange={(v) => setD('sales', v)}
            options={USERS.map((u) => ({ value: String(u.id), label: u.name }))}
            searchPlaceholder="พิมพ์ชื่อพนักงานขาย…"
          />
        </Field>
        <Field label="สถานะการอนุมัติ">
          <Select value={draft.approve} onChange={(e) => setD('approve', e.target.value)}>
            <option value="">ทั้งหมด</option>
            {Object.keys(TONE).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      <DataTable
        narrowed={narrowed}
        onClearFilters={reset}
        searchable={false}
        columns={columns}
        rows={SALE_ORDERS}
        loading={loading}
        error={loadError}
        onRetry={retryLoad}
        rowKey={(r) => r.no}
        server={{ ...server, total }}
      />
    </>
  );
}

export default function SaleOrderPage() {
  return (
    <React.Suspense fallback={null}>
      <SaleOrderList />
    </React.Suspense>
  );
}
