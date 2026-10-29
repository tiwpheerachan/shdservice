import { NextResponse, type NextRequest } from 'next/server';
import { handle, HttpError, parseBody, parseParams, requireCan } from '@/server/auth';
import { saleOrderTracking } from '@/server/contract/sales';
import { setTracking, saleOrderNoOf } from '@/server/services/sale-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireCan(req, 'Sale Order', 'edit');
  const { id } = await parseParams(ctx, saleOrderTracking);
  const no = await saleOrderNoOf(id);
  if (!no) throw new HttpError(404, 'ไม่พบใบสั่งขาย');
  const { tracking, version } = await parseBody(req, saleOrderTracking); // as text
  // checked in setTracking against the number stored now (trackingSchema — an unchanged legacy one passes)
  const order = await setTracking(no, tracking, user.userId, version);
  return NextResponse.json({ ok: true, order });
});
