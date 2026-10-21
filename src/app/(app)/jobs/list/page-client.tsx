'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Printer, Layers, Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useJobsPage, useStaff, useJobStats } from '@/data/db';
import { cn } from '@/lib/utils';
import { exportXlsx } from '@/lib/api';
import { useAccess } from '@/lib/use-access';
import { ExportButton } from '@/components/shared/export-button';
import { toParams, useJobListUrl } from './use-job-list-url';
import { JobFilterBar } from './job-filter-bar';
import { jobColumns } from './job-columns';
import { SourceChips } from './source-chips';
import { useJobCallModal } from './job-call-modal';

function StatChip({
  icon: Icon,
  label,
  value,
  tone,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone: 'primary' | 'info' | 'warning' | 'success';
  loading?: boolean;
}) {
  const c = {
    primary: 'text-primary bg-primary-soft',
    info: 'text-info bg-info-soft',
    warning: 'text-warning bg-warning-soft',
    success: 'text-success bg-success-soft',
  }[tone];
  return (
    <div className="surface flex items-center gap-3 p-3">
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', c)}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-2xs text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-5 w-12" />
        ) : (
          <p className="num text-lg font-semibold leading-tight tabular-nums">{value.toLocaleString('en-US')}</p>
        )}
      </div>
    </div>
  );
}

export default function JobListPage() {
  const access = useAccess();
  const { add: canAdd, edit: canEdit } = access.forPath('/jobs/list');
  const { data: STAFF, ...staffLookup } = useStaff();
  const { data: statRows, loading: statsLoading } = useJobStats();
  // filters + table state, kept in the URL; tat / kpi = the dashboard card a deep link came from
  const { init, draft, setDraft, setD, filters, narrowed, table, pageArgs, server, tat, kpi, clearAll, onSearch } =
    useJobListUrl();
  const {
    rows: JOBS,
    total,
    loading,
    error: loadError,
    refetch: retryLoad,
  } = useJobsPage({ ...pageArgs, ...toParams(filters) });
  const { openCall, modal: callModal } = useJobCallModal();

  const stats = statRows[0] ?? { total: 0, fresh: 0, done: 0, progress: 0 };
  const columns = jobColumns({ jobLink: access.jobLink, canEdit, onCall: openCall });

  return (
    <>
      <PageHeader
        title="รายการงานทั้งหมด"
        description={`ทะเบียนงานบริการทั้งหมด ${stats.total.toLocaleString('en-US')} รายการในระบบ`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              พิมพ์
            </Button>
            <ExportButton run={() => exportXlsx('jobs', { q: table.q, ...toParams(filters) })} />
            {canAdd && (
              <Link href="/jobs/new">
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  เปิดงานใหม่
                </Button>
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatChip icon={Layers} label="งานทั้งหมด" value={stats.total} tone="primary" loading={statsLoading} />
        <StatChip icon={Sparkles} label="งานใหม่" value={stats.fresh} tone="info" loading={statsLoading} />
        <StatChip icon={Loader2} label="กำลังดำเนินการ" value={stats.progress} tone="warning" loading={statsLoading} />
        <StatChip
          icon={CheckCircle2}
          label="ซ่อมเสร็จ / ปิดงาน"
          value={stats.done}
          tone="success"
          loading={statsLoading}
        />
      </div>

      <JobFilterBar
        draft={draft}
        setDraft={setDraft}
        setD={setD}
        onSearch={onSearch}
        onReset={clearAll}
        staff={STAFF}
        staffLookup={staffLookup}
      />

      <SourceChips
        filters={filters}
        tat={tat}
        kpi={kpi}
        staff={STAFF}
        loading={loading}
        total={total}
        onClear={clearAll}
      />

      <DataTable
        narrowed={narrowed}
        onClearFilters={clearAll}
        searchable={false}
        columns={columns}
        rows={JOBS}
        loading={loading}
        error={loadError}
        onRetry={retryLoad}
        rowKey={(r) => r.no}
        pageSize={init.pageSize}
        server={{ ...server, total }}
      />

      {callModal}
    </>
  );
}
