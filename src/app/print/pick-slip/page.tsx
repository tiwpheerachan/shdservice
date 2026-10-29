import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { userFromCookies, canViewAny } from '@/server/auth';
import { PickSlipDoc } from '@/components/print/docs/pick-slip';

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
  if (!user || !(await canViewAny(user, ['Quotation']))) notFound();
  const ids = [(await searchParams).ids ?? ''].flat().flatMap((v) => v.split(','));
  return <PickSlipDoc ids={ids} />;
}
