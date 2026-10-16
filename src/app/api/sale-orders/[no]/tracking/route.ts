import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan } from '@/server/auth';
import { saleOrderTracking } from '@/server/contract/sales';
import { setTracking } from '@/server/services/sale-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, 'Sale Order', 'edit');
  const { no } = await parseParams(ctx, saleOrderTracking);
  const { tracking } = await parseBody(req, saleOrderTracking); // as text
  // checked in setTracking against the number stored now (trackingSchema — an unchanged legacy one passes)
  const order = await setTracking(decodeURIComponent(no), tracking, user.userId);
  return NextResponse.json({ ok: true, order });
});
