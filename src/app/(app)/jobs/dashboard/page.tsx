import { Prefetched } from '@/data/db';
import { tableKey } from '@/data/keys';
import { prefetch } from '@/server/prefetch';
import DashboardPage from './page-client';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  // none = ทั้งหมด (every date, as the legacy dashboard), every type; ?from=&to= set a range (Thai calendar, lib/dates)
  const q = await searchParams;
  const day = (k: string) => {
    const v = q[k];
    return typeof v === 'string' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : undefined;
  };
  const range = {
    from: day('from') ?? '',
    to: day('to') ?? '',
    type: typeof q.type === 'string' ? q.type : '',
  };
  const fallback = await prefetch([
    tableKey('dashboard', 'exclude', range), // useDashboard(range)
    tableKey('jobs', 'exclude', { limit: 6, ...range }), // useJobs({ limit: 6, ...range })
  ]);
  return (
    <Prefetched fallback={fallback}>
      <DashboardPage initial={range} />
    </Prefetched>
  );
}
