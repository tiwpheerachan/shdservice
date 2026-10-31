import { Prefetched } from '@/data/db';
import { FIRST_PAGE, pageArgsOf, pagedKey, tableKey } from '@/data/keys';
import { prefetch, searchOf, type SearchParams } from '@/server/prefetch';
import { fromQuery, toParams } from './filters';
import JobListPage from './page-client';

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const init = fromQuery(searchOf(await searchParams));
  const table = { ...FIRST_PAGE, page: init.page, pageSize: init.pageSize, sort: init.sort };
  const fallback = await prefetch([
    pagedKey('jobs', { ...pageArgsOf(table), ...toParams(init.filters) }), // useJobsPage
    tableKey('job_stats'), // useJobStats
  ]);
  return (
    <Prefetched fallback={fallback}>
      <JobListPage />
    </Prefetched>
  );
}
