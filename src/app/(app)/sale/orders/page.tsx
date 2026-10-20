import { Prefetched } from '@/data/db';
import { FIRST_PAGE, pageArgsOf, pagedKey } from '@/data/keys';
import { prefetch, searchOf, type SearchParams } from '@/server/prefetch';
import { NO_FILTER, WAITING, listParams } from './filters';
import SaleOrderPage from './page-client';

/** page 1 of the sale order list (?pending=1: รออนุมัติ only, as the page does) in the HTML, then the client page */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const pending = searchOf(await searchParams).get('pending') === '1';
  const filters = pending ? { ...NO_FILTER, approve: WAITING } : NO_FILTER;
  const fallback = await prefetch([pagedKey('sale_orders', { ...pageArgsOf(FIRST_PAGE), ...listParams(filters) })]); // useSaleOrdersPage
  return (
    <Prefetched fallback={fallback}>
      <SaleOrderPage />
    </Prefetched>
  );
}
