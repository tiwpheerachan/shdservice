import { NextResponse, type NextRequest } from 'next/server';
import { handle, HttpError, parseParams, requireView } from '@/server/auth';
import { saleOrderGet } from '@/server/contract/sales';
import { getSaleOrder, saleOrderNoOf } from '@/server/services/sale-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await requireView(req, ['Sale Order', 'Product Pick Stock']);
  const { id } = await parseParams(ctx, saleOrderGet); // not a uuid (an old SO link) → 404
  const no = await saleOrderNoOf(id);
  const order = no && (await getSaleOrder(no));
  if (!order) throw new HttpError(404, 'ไม่พบใบสั่งขาย');
  return NextResponse.json({ order });
});
