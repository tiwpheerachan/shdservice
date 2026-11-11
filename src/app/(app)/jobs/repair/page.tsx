import { Prefetched } from '@/data/db';
import { jobIdParam, jobKey, tableKey } from '@/data/keys';
import { packPrefetched, prefetchRaw, searchOf, type SearchParams } from '@/server/prefetch';
import { pack } from '@/lib/obscure';
import type { JobDetail } from '@/server/services/jobs';
import RepairPage from './page-client';

/** lookups the filled form shows text from: useStaff (มอบหมายงานนี้ให้ + its hint), useManufacturers (ยี่ห้อ) */
const LOOKUPS = [tableKey('staff'), tableKey('manufacturers', 'active')];

/** the job from ?id= in the HTML (useJob's record) — and the form's first state, so the HTML is the filled form */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const id = jobIdParam(searchOf(await searchParams)).toLowerCase();
  const key = id ? jobKey(id) : '';
  const got = key ? await prefetchRaw([key, ...LOOKUPS]) : {};
  const answer = got[key] as { job: JobDetail } | undefined;
  // keyed by the job: Next keeps the page mounted when only ?id= changes (a link to another job)
  return (
    <Prefetched fallback={packPrefetched(answer ? { ...got, [key]: answer.job } : got)}>
      {/* packed: the job holds its customer's e-mail, and no address may be in the server HTML (src/lib/obscure.ts) */}
      <RepairPage key={id} jobPacked={answer ? pack(JSON.stringify(answer.job)) : undefined} />
    </Prefetched>
  );
}
