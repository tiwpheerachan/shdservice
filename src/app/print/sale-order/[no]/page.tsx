import { notFound } from "next/navigation";
import { getSaleOrder } from "@/server/services/sale-orders";
import { ShippingLabel } from "@/components/print/shipping-label";

export const dynamic = "force-dynamic";

/** พิมพ์ใบสั่งขาย = ใบปะหน้าพัสดุ A5 (what the legacy app printed for a sale order). */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const o = await getSaleOrder(decodeURIComponent(no).toUpperCase());
  if (!o) notFound();
  const c = o.customerDetail;
  return <ShippingLabel docNo={o.no} name={c.name} address={c.address} phone={c.phone} subDistrict={c.subDistrict} district={c.district} province={c.province} />;
}
