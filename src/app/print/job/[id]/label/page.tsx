import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getJob } from '@/server/services/jobs';
import { getCustomerByCode, addressNames } from '@/server/services/customers';
import { ShippingLabel } from '@/components/print/shipping-label';
import { profileForDocument } from '@/server/services/document-profiles';
import { printJobNo } from '../job-no';

export const dynamic = 'force-dynamic';

/** the tab / window title names the document (root template: "… · OneService") */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `ใบปะหน้าพัสดุ ${(await printJobNo((await params).id)) ?? ''}`.trim() };
}

/** ใบปะหน้าพัสดุสำหรับงานซ่อมที่ส่งคืนทางขนส่ง — same A5 sheet as the sale order, keyed by the job's uuid. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const no = await printJobNo((await params).id);
  if (!no) notFound();
  const j = await getJob(no);
  if (!j) notFound();
  const cust = j.customer?.code ? await getCustomerByCode(j.customer.code) : null;
  const names = await addressNames(cust);
  const co = await profileForDocument(j.documentProfileId);
  return (
    <ShippingLabel
      profile={co}
      docNo={j.no}
      name={j.customer?.name ?? ''}
      address={j.customer?.address ?? ''}
      phone={j.customer?.phone ?? ''}
      subDistrict={names.subDistrict}
      district={names.district}
      province={names.province}
    />
  );
}
