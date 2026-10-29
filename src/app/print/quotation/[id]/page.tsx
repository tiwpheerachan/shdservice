import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { userFromCookies, canViewAny } from '@/server/auth';
import { QuotationDoc } from '@/components/print/docs/quotation';
import { quotationNoOf } from '@/server/services/quotations';

export const dynamic = 'force-dynamic';

/** the tab / window title names the document (root template: "… · OneService") */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `ใบเสนอราคา ${(await quotationNoOf((await params).id)) ?? ''}`.trim() };
}

/** staff print view (login required by app/print/layout.tsx), /print/quotation/{the quotation's uuid} — the
 *  customer gets the same sheet via /track/doc */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // same rule as the API: the layout only checks sign-in, the role must be able to view this document
  const user = await userFromCookies();
  if (!user || !(await canViewAny(user, ['Quotation']))) notFound();
  const no = await quotationNoOf(id); // an old number link → not found (ADR 0008: no redirect)
  if (!no) notFound();
  return <QuotationDoc no={no} />;
}
