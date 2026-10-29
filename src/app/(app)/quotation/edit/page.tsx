import { Prefetched } from '@/data/db';
import { quotationKey, recordNo } from '@/data/keys';
import { prefetch, searchOf, type SearchParams } from '@/server/prefetch';
import EditQuotationPage from './page-client';

/** the quotation from ?id= (its uuid) in the HTML (the page's useRecord) */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const id = recordNo(searchOf(await searchParams).get('id') ?? ''); // as useRecord reads `initial`
  const key = id ? quotationKey(id) : '';
  const got = key ? await prefetch([key]) : {};
  const answer = got[key] as { quotation: unknown } | undefined;
  // keyed by the id: Next keeps the page mounted when only ?id= changes (a link to another quotation)
  return (
    <Prefetched fallback={answer ? { ...got, [key]: answer.quotation } : got}>
      <EditQuotationPage key={id} />
    </Prefetched>
  );
}
