import { notFound } from 'next/navigation';
import { userFromCookies, canViewAny } from '@/server/auth';
import { QuotationDoc } from '@/components/print/docs/quotation';

export const dynamic = 'force-dynamic';

/** staff print view (login required by app/print/layout.tsx) — the customer gets the same sheet via /track/doc */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  // same rule as the API: the layout only checks sign-in, the role must be able to view this document
  const user = await userFromCookies();
  if (!user || !(await canViewAny(user, ['Quotation']))) notFound();
  return <QuotationDoc no={decodeURIComponent(no).toUpperCase()} />;
}
