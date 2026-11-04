import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getJob } from '@/server/services/jobs';
import { ShippingLabel } from '@/components/print/shipping-label';
import { profileForDocument } from '@/server/services/document-profiles';
import { logJobPrint, printJobNo } from '../job-no';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `ใบปะหน้าพัสดุ ${(await printJobNo((await params).id)) ?? ''}`.trim() };
}

/** ใบปะหน้าพัสดุสำหรับงานซ่อมที่ส่งคืนทางขนส่ง — same A5 sheet as the sale order, keyed by the job's uuid. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const no = await printJobNo(id);
  if (!no) notFound();
  await logJobPrint(id, no, 'ใบปะหน้าพัสดุ');
  const j = await getJob(no);
  if (!j) notFound();
  const co = await profileForDocument(j.documentProfileId);
  return (
    <ShippingLabel
      profile={co}
      docNo={j.no}
      name={j.customer?.name ?? ''}
      address={j.customer?.address ?? ''}
      phone={j.customer?.phone ?? ''}
    />
  );
}
