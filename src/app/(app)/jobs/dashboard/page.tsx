import { Prefetched } from '@/data/db';
import { tableKey } from '@/data/keys';
import { daysAgo, today } from '@/lib/dates';
import { prefetch } from '@/server/prefetch';
import DashboardPage from './page-client';

/** the dashboard and the latest jobs for its opening range in the HTML */
export default async function Page() {
  // DashboardPage's first range (last 30 days, every type) — Thai calendar on both sides (lib/dates)
  const range = { from: daysAgo(29), to: today(), type: '' };
  const fallback = await prefetch([
    tableKey('dashboard', 'exclude', range), // useDashboard(range)
    tableKey('jobs', 'exclude', { limit: 6, ...range }), // useJobs({ limit: 6, ...range })
  ]);
  return (
    <Prefetched fallback={fallback}>
      <DashboardPage />
    </Prefetched>
  );
}
