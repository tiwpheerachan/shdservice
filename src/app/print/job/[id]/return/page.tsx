import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReturnNoteDoc } from '@/components/print/docs/return-note';
import { logJobPrint, printJobNo } from '../job-no';

export const dynamic = 'force-dynamic';

/** the tab / window title names the document (root template: "… · OneService") */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `ใบส่งคืนสินค้า ${(await printJobNo((await params).id)) ?? ''}`.trim() };
}

/** staff print view (login required by app/print/layout.tsx) — the customer gets the same sheet via /track/doc */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const no = await printJobNo(id);
  if (!no) notFound();
  await logJobPrint(id, no, 'ใบส่งคืนสินค้า');
  return <ReturnNoteDoc no={no} />;
}
