import AnomaliesPage from './page-client';

/** System Admin only (the /admin prefix, lib/modules ADMIN_ONLY_PREFIXES; the API checks too). ?category= from the bell */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const c = (await searchParams).category;
  return <AnomaliesPage category={typeof c === 'string' ? c : ''} />;
}
