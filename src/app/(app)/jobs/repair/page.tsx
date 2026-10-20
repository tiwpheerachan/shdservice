import { Prefetched } from '@/data/db';
import { jobKey, jobNoParam, recordNo, tableKey } from '@/data/keys';
import { prefetch, searchOf, type SearchParams } from '@/server/prefetch';
import type { JobDetail } from '@/server/services/jobs';
import RepairPage from './page-client';

/** lookups the filled form shows text from: useStaff (มอบหมายงานนี้ให้ + its hint), useManufacturers (ยี่ห้อ) */
const LOOKUPS = [tableKey('staff'), tableKey('manufacturers', 'active')];

/** the job from ?job= in the HTML (useJob's record) — and the form's first state, so the HTML is the filled form */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const no = recordNo(jobNoParam(searchOf(await searchParams)));
  const key = no ? jobKey(no) : '';
  const got = key ? await prefetch([key, ...LOOKUPS]) : {};
  const answer = got[key] as { job: JobDetail } | undefined;
  const lookups = Object.fromEntries(LOOKUPS.filter((k) => k in got).map((k) => [k, got[k]]));
  return (
    <Prefetched fallback={answer ? { ...lookups, [key]: answer.job } : lookups}>
      <RepairPage job={answer?.job} />
    </Prefetched>
  );
}
