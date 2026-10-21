import { Prefetched } from '@/data/db';
import { FIRST_PAGE, pageArgsOf, pagedKey } from '@/data/keys';
import { prefetch } from '@/server/prefetch';
import { NO_FILTER } from './filters';
import CustomersPage from './page-client';

/** page 1 of the customer list in the HTML */
export default async function Page() {
  const fallback = await prefetch([pagedKey('customers', { ...pageArgsOf(FIRST_PAGE), ...NO_FILTER })]); // useCustomersPage
  return (
    <Prefetched fallback={fallback}>
      <CustomersPage />
    </Prefetched>
  );
}
