import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RepairCloseDoc } from '@/components/print/docs/repair-close';
import { logJobPrint, printJobNo } from '../job-no';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `ใบปิดงานซ่อม ${(await printJobNo((await params).id)) ?? ''}`.trim() };
}

/** staff print view (login required by app/print/layout.tsx), any job status */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const no = await printJobNo(id);
  if (!no) notFound();
  await logJobPrint(id, no, 'ใบปิดงานซ่อม');
  return <RepairCloseDoc no={no} />;
}
