import { notFound } from "next/navigation";
import { getJob } from "@/server/services/jobs";
import { getCustomerByCode, addressNames } from "@/server/services/customers";
import { ShippingLabel } from "@/components/print/shipping-label";
import { profileForDocument } from "@/server/services/document-profiles";

export const dynamic = "force-dynamic";

/** ใบปะหน้าพัสดุสำหรับงานซ่อมที่ส่งคืนทางขนส่ง — same A5 sheet as the sale order, keyed by job no. */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const j = await getJob(decodeURIComponent(no).toUpperCase());
  if (!j) notFound();
  const cust = j.customer?.code ? await getCustomerByCode(j.customer.code) : null;
  const names = await addressNames(cust);
  const co = await profileForDocument(j.documentProfileId);
  return (
    <ShippingLabel
      profile={co}
      docNo={j.no}
      name={j.customer?.name ?? ""}
      address={j.customer?.address ?? ""}
      phone={j.customer?.phone ?? ""}
      subDistrict={names.subDistrict}
      district={names.district}
      province={names.province}
    />
  );
}
