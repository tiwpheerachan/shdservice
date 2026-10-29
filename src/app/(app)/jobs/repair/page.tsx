import { Prefetched } from '@/data/db';
import { jobIdParam, jobKey, tableKey } from '@/data/keys';
import { prefetch, searchOf, type SearchParams } from '@/server/prefetch';
import type { JobDetail } from '@/server/services/jobs';
import RepairPage from './page-client';

/** lookups the filled form shows text from: useStaff (มอบหมายงานนี้ให้ + its hint), useManufacturers (ยี่ห้อ) */
const LOOKUPS = [tableKey('staff'), tableKey('manufacturers', 'active')];

/** the job from ?id= in the HTML (useJob's record) — and the form's first state, so the HTML is the filled form */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const id = jobIdParam(searchOf(await searchParams)).toLowerCase();
  const key = id ? jobKey(id) : '';
  const got = key ? await prefetch([key, ...LOOKUPS]) : {};
  const answer = got[key] as { job: JobDetail } | undefined;
  // keyed by the job: Next keeps the page mounted when only ?id= changes (a link to another job)
  return (
    <Prefetched fallback={answer ? { ...got, [key]: answer.job } : got}>
      <RepairPage key={id} job={answer?.job} />
    </Prefetched>
  );
}
