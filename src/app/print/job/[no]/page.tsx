import { notFound } from 'next/navigation';
import { userFromCookies, canViewAny, JOB_MODULES } from '@/server/auth';
import { JobReceiptDoc } from '@/components/print/docs/job-receipt';

export const dynamic = 'force-dynamic';

/** staff print view (login required by app/print/layout.tsx) — the customer gets the same sheet via /track/doc */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  // also checked by ../layout.tsx, but layouts can be skipped on partial renders — check here too
  const user = await userFromCookies();
  if (!user || !(await canViewAny(user, JOB_MODULES))) notFound();
  return <JobReceiptDoc no={decodeURIComponent(no).toUpperCase()} />;
}
