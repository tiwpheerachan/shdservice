import type { Metadata } from 'next';
import { userFromCookies, canViewAny } from '@/server/auth';
import { notFound } from 'next/navigation';
import { getSaleOrder, saleOrderNoOf } from '@/server/services/sale-orders';
import { ShippingLabel } from '@/components/print/shipping-label';
import { profileForDocument } from '@/server/services/document-profiles';
import { SO_CANCELLED } from '@/lib/validation/sale-order';
import { AS } from '@/lib/status-ids';
import { db } from '@/db/client';
import { audit } from '@/server/audit';
import { runInPage } from '@/server/request-context';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `ใบสั่งขาย ${(await saleOrderNoOf((await params).id)) ?? ''}`.trim() };
}

/** พิมพ์ใบสั่งขาย = ใบปะหน้าพัสดุ A5 (what the legacy app printed for a sale order): /print/sale-order/{its uuid} */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // same rule as the API: the layout only checks sign-in, the role must be able to view this document
  const user = await userFromCookies();
  if (!user) notFound();
  // in the page's request context: the PRINT line names the ip / device / session and the permission the check used
  return runInPage(user, async () => {
    if (!(await canViewAny(user, ['Sale Order', 'Product Pick Stock']))) notFound();
    const no = await saleOrderNoOf(id); // an old SO link → not found (ADR 0008: no redirect)
    const o = no ? await getSaleOrder(no) : null;
    if (!o) notFound();
    // a cancelled or denied order is not a document any more — refused here, not only by hiding the button
    if (o.cancelled || o.approveId === AS.DENIED)
      return (
        <p role="alert" className="mx-auto max-w-md rounded-md bg-white p-6 text-center text-lg font-medium">
          {o.cancelled ? SO_CANCELLED : 'ใบสั่งขายนี้ถูกปฏิเสธแล้ว'} — พิมพ์ไม่ได้
        </p>
      );
    // PRINT event (audit() files it in security_log): who printed which sale order
    await audit(db, user.pk, {
      action: 'PRINT',
      module: 'Sale Order',
      entity: 'sale_order',
      key: o.id,
      no: o.no,
      summary: `พิมพ์ใบสั่งขาย ${o.no}`,
    });
    const c = o.customerDetail;
    const co = await profileForDocument(o.documentProfileId);
    return (
      <ShippingLabel
        profile={co}
        docNo={o.no}
        name={c.name}
        address={c.address}
        phone={c.phone}
        subDistrict={c.subDistrict}
        district={c.district}
        province={c.province}
      />
    );
  });
}
