import { Prefetched } from '@/data/db';
import { quotationKey, recordNo } from '@/data/keys';
import { prefetch, searchOf, type SearchParams } from '@/server/prefetch';
import EditQuotationPage from './page-client';

/** the quotation from ?no= in the HTML (the page's useRecord) */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const no = recordNo(searchOf(await searchParams).get('no') ?? ''); // the page's initialNo
  const key = no ? quotationKey(no) : '';
  const got = key ? await prefetch([key]) : {};
  const answer = got[key] as { quotation: unknown } | undefined;
  // keyed by the number: Next keeps the page mounted when only ?no= changes (a link to another quotation)
  return (
    <Prefetched fallback={answer ? { ...got, [key]: answer.quotation } : got}>
      <EditQuotationPage key={no} />
    </Prefetched>
  );
}
