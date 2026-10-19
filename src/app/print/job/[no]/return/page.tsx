import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { userFromCookies, canViewAny, JOB_MODULES } from '@/server/auth';
import { ReturnNoteDoc } from '@/components/print/docs/return-note';

export const dynamic = 'force-dynamic';

/** the tab / window title names the document (root template: "… · OneService") */
export async function generateMetadata({ params }: { params: Promise<{ no: string }> }): Promise<Metadata> {
  return { title: `ใบส่งคืนสินค้า ${decodeURIComponent((await params).no).toUpperCase()}` };
}

/** staff print view (login required by app/print/layout.tsx) — the customer gets the same sheet via /track/doc */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  // also checked by ../layout.tsx, but layouts can be skipped on partial renders — check here too
  const user = await userFromCookies();
  if (!user || !(await canViewAny(user, JOB_MODULES))) notFound();
  return <ReturnNoteDoc no={decodeURIComponent(no).toUpperCase()} />;
}
