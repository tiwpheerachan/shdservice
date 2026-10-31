import { Prefetched } from '@/data/db';
import { FIRST_PAGE, pageArgsOf } from '@/data/keys';
import { prefetch } from '@/server/prefetch';
import { NO_FILTER, PAGE_SIZE, listKey } from './filters';
import AuditPage from './page-client';

/** page 1 in the HTML so the table never grows in after first paint (CLS) */
export default async function Page() {
  const fallback = await prefetch([listKey({ ...pageArgsOf({ ...FIRST_PAGE, pageSize: PAGE_SIZE }), ...NO_FILTER })]);
  return (
    <Prefetched fallback={fallback}>
      <AuditPage />
    </Prefetched>
  );
}
