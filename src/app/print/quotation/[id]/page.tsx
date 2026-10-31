import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { userFromCookies, canViewAny } from '@/server/auth';
import { QuotationDoc } from '@/components/print/docs/quotation';
import { quotationNoOf } from '@/server/services/quotations';
import { db } from '@/db/client';
import { audit } from '@/server/audit';
import { runInPage } from '@/server/request-context';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `ใบเสนอราคา ${(await quotationNoOf((await params).id)) ?? ''}`.trim() };
}

/** staff print view (login required by app/print/layout.tsx), /print/quotation/{the quotation's uuid} — the
 *  customer gets the same sheet via /track/doc */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // same rule as the API: the layout only checks sign-in, the role must be able to view this document
  const user = await userFromCookies();
  if (!user) notFound();
  // in the page's request context: the PRINT line names the ip / device / session and the permission the check used
  return runInPage(user, async () => {
    if (!(await canViewAny(user, ['Quotation']))) notFound();
    const no = await quotationNoOf(id); // an old number link → not found (ADR 0008: no redirect)
    if (!no) notFound();
    // PRINT event (audit() files it in security_log): who opened which quotation for printing
    await audit(db, user.pk, {
      action: 'PRINT',
      module: 'Quotation',
      entity: 'quotation',
      key: id.toLowerCase(),
      no,
      summary: `พิมพ์ใบเสนอราคา ${no}`,
    });
    return <QuotationDoc no={no} />;
  });
}
