'use client';

import Link from 'next/link';
import { Phone } from 'lucide-react';
import { RowActions } from '@/components/shared/row-actions';
import type { Column } from '@/components/ui/data-table';
import { StatusBadge, Badge } from '@/components/ui/badge';
import type { Job } from '@/data/types';
import { baht } from '@/lib/utils';
import type { useAccess } from '@/lib/use-access';
import { brandModelColumn, COL_MIN_WIDTH } from '@/components/shared/table-columns';

export function jobColumns({
  jobLink,
  canEdit,
  onCall,
}: {
  jobLink: ReturnType<typeof useAccess>['jobLink'];
  canEdit: boolean;
  /** the phone button in the customer cell (in the Action cell on phones): customer info / call log */
  onCall: (job: Job) => void;
}): Column<Job>[] {
  // phones (below sm) keep เลขที่งาน / สถานะ / Action — the rest pushed them off a 360px screen
  return [
    {
      key: 'no',
      header: 'เลขที่งาน',
      width: '130px',
      cell: (r) => (
        <Link {...jobLink(r.no)} prefetch={false} className="num font-medium text-primary hover:underline">
          {r.no}
        </Link>
      ),
    },
    {
      key: 'openDate',
      header: 'วันที่เปิดงาน',
      width: '140px',
      hideBelow: 'sm',
      cell: (r) => <span className="num text-xs">{r.openDate}</span>,
    },
    {
      key: 'customer',
      header: 'ลูกค้า',
      minWidth: COL_MIN_WIDTH.customer,
      hideBelow: 'sm',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onCall(r)}
            title="ดูข้อมูลลูกค้า / Call Log"
            aria-label={`ข้อมูลลูกค้า ${r.customer}`}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <Phone className="h-3 w-3" />
          </button>
          <span className="line-clamp-1 max-w-[220px]" title={r.customer}>
            {r.customer}
          </span>
        </span>
      ),
    },
    {
      key: 'so',
      header: 'เลขคำสั่งซื้อ',
      width: '120px',
      hideBelow: 'lg',
      cell: (r) => <span className="num text-xs">{r.so}</span>,
    },
    brandModelColumn(),
    {
      key: 'jobType',
      header: 'ประเภทงาน',
      hideBelow: 'xl',
      cell: (r) => (
        <Badge tone="primary" wrap>
          {r.jobType}
        </Badge>
      ),
    },
    { key: 'owner', header: 'ผู้รับผิดชอบ', hideBelow: 'lg' },
    {
      key: 'amount',
      header: 'มูลค่า',
      align: 'right',
      width: '100px',
      hideBelow: 'xl',
      value: (r) => r.amount,
      cell: (r) => baht(r.amount),
    },
    {
      key: 'status',
      header: 'สถานะงาน',
      minWidth: COL_MIN_WIDTH.status,
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusBadge status={r.status} group={r.statusGroup} wrap />
          {r.isBounce && (
            <Badge tone="warning" className="px-1.5">
              งานเด้ง
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      width: '110px',
      align: 'center',
      sortable: false,
      cell: (r) => (
        <span className="flex items-center justify-center gap-0.5">
          {/* phones: the customer column (and its phone button) is hidden — the call log stays one tap away */}
          <button
            type="button"
            onClick={() => onCall(r)}
            title="ดูข้อมูลลูกค้า / Call Log"
            aria-label={`ข้อมูลลูกค้า ${r.customer}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary-soft sm:hidden"
          >
            <Phone className="h-3.5 w-3.5" />
          </button>
          <RowActions
            viewHref={jobLink(r.no).href}
            editHref={canEdit ? `/jobs/edit?job=${encodeURIComponent(r.no)}` : undefined}
          />
        </span>
      ),
    },
  ];
}
