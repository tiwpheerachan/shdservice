import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { userFromCookies, canViewAny } from '@/server/auth';
import { inArray } from 'drizzle-orm';
import { PickSlipDoc } from '@/components/print/docs/pick-slip';
import { db } from '@/db/client';
import { quotation } from '@/db/schema';
import { audit, isUuid } from '@/server/audit';
import { runInPage } from '@/server/request-context';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'ใบเบิกสินค้า' };

/** ใบเบิกสินค้า of the quotations ticked in the list: /print/pick-slip?ids=<uuid>,<uuid> (login: app/print/layout.tsx) */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // the quotation print's rule: the role must be able to view quotations
  const user = await userFromCookies();
  if (!user) notFound();
  // in the page's request context: the PRINT lines name the ip / device / session and the permission the check used
  return runInPage(user, async () => {
    if (!(await canViewAny(user, ['Quotation']))) notFound();
    const ids = [(await searchParams).ids ?? ''].flat().flatMap((v) => v.split(','));
    // PRINT event per quotation (audit() files it in security_log) — the slip is the quotation's document
    const uuids = ids.filter(isUuid).map((v) => v.trim().toLowerCase());
    const printed = uuids.length
      ? await db
          .select({ id: quotation.id, no: quotation.quotationNo })
          .from(quotation)
          .where(inArray(quotation.id, uuids))
      : [];
    if (printed.length)
      await audit(
        db,
        user.pk,
        printed.map((q) => ({
          action: 'PRINT' as const,
          module: 'Quotation',
          entity: 'quotation',
          key: q.id,
          no: q.no,
          summary: `พิมพ์ใบเบิกสินค้า ${q.no ?? ''}`.trim(),
        })),
      );
    return <PickSlipDoc ids={ids} />;
  });
}
