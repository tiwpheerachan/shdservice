import { NextResponse, type NextRequest } from 'next/server';
import { handle, hasRight, HttpError, requireCan } from '@/server/auth';
import { pendingSaleOrders } from '@/server/services/alerts';
import { NOT_APPROVER } from '@/lib/validation/sale-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — the notification bell: sale orders waiting for approval (SO Approve only), minus the viewer's own */
export const GET = handle(async (req: NextRequest) => {
  // edit, as approving needs (POST /api/sale-orders/[no]/approve) — a view-only role is never asked to approve
  const me = await requireCan(req, 'Sale Order', 'edit');
  if (!(await hasRight(me, 'SO Approve'))) throw new HttpError(403, NOT_APPROVER);
  return NextResponse.json(await pendingSaleOrders(me), { headers: { 'Cache-Control': 'no-store' } });
});
