import { Prefetched } from '@/data/db';
import { FIRST_PAGE, pageArgsOf, pagedKey, tableKey } from '@/data/keys';
import { prefetch } from '@/server/prefetch';
import { startQuery } from './filters';
import OpenJobReport from './page-client';

export default async function Page() {
  const query = startQuery();
  const fallback = await prefetch([
    tableKey('job_summary', 'exclude', { ...query, q: FIRST_PAGE.q }), // useJobSummary
    pagedKey('report_rows', { ...pageArgsOf(FIRST_PAGE), ...query, report: 'open_job' }), // useReportRows
  ]);
  return (
    <Prefetched fallback={fallback}>
      <OpenJobReport />
    </Prefetched>
  );
}
