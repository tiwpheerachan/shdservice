import { NextResponse, type NextRequest } from 'next/server';
import { handle, HttpError, parseParams, requireView } from '@/server/auth';
import { saleOrderGet } from '@/server/contract/sales';
import { getSaleOrder } from '@/server/services/sale-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  await requireView(req, ['Sale Order', 'Product Pick Stock']);
  const { no } = await parseParams(ctx, saleOrderGet);
  const order = await getSaleOrder(no.trim().toUpperCase());
  if (!order) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + no);
  return NextResponse.json({ order });
});
