import { Prefetched } from '@/data/db';
import { tableKey } from '@/data/keys';
import { daysAgo, today } from '@/lib/dates';
import { prefetch } from '@/server/prefetch';
import DashboardPage from './page-client';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  // none = the last 30 days, every type (Thai calendar, lib/dates); ?from=&to= both empty = ทั้งหมด
  const q = await searchParams;
  const day = (k: string) => {
    const v = q[k];
    return typeof v === 'string' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : undefined;
  };
  const range = {
    from: day('from') ?? daysAgo(29),
    to: day('to') ?? today(),
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
