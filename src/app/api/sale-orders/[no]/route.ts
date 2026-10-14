import { NextResponse, type NextRequest } from 'next/server';
import { handle, HttpError, requireView } from '@/server/auth';
import { getSaleOrder } from '@/server/services/sale-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  await requireView(req, ['Sale Order', 'Product Pick Stock']);
  const { no } = await ctx.params;
  const order = await getSaleOrder(decodeURIComponent(no).trim().toUpperCase());
  if (!order) throw new HttpError(404, 'ไม่พบใบสั่งขาย ' + no);
  return NextResponse.json({ order });
});
