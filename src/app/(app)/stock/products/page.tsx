import { Prefetched } from '@/data/db';
import { FIRST_PAGE, pageArgsOf, pagedKey, tableKey } from '@/data/keys';
import { prefetch } from '@/server/prefetch';
import { NO_FILTER } from './filters';
import ProductsPage from './page-client';

export default async function Page() {
  const query = { q: FIRST_PAGE.q, ...NO_FILTER }; // ProductsPage's `query` before any search
  const fallback = await prefetch([
    pagedKey('products', { ...pageArgsOf(FIRST_PAGE), ...query }), // useProductsPage
    tableKey('product_stats', 'exclude', query), // useProductStats
  ]);
  return (
    <Prefetched fallback={fallback}>
      <ProductsPage />
    </Prefetched>
  );
}
