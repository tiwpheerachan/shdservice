import { Prefetched } from '@/data/db';
import { quotationKey, recordNo } from '@/data/keys';
import { prefetch, searchOf, type SearchParams } from '@/server/prefetch';
import EditQuotationPage from './page-client';

/** the quotation from ?no= in the HTML (the page's useRecord) */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const no = recordNo(searchOf(await searchParams).get('no') ?? ''); // the page's initialNo
  const key = no ? quotationKey(no) : '';
  const answer = key ? ((await prefetch([key]))[key] as { quotation: unknown } | undefined) : undefined;
  return (
    <Prefetched fallback={answer ? { [key]: answer.quotation } : {}}>
      <EditQuotationPage />
    </Prefetched>
  );
}
