import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseParams, requireView, HttpError, PRODUCT_MODULES } from '@/server/auth';
import { productGet } from '@/server/contract/stock';
import { canSeeCost, getProduct, productStockCard, withoutCost } from '@/server/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Product detail + stock card (product-detail modal). */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => {
  const user = await requireView(req, PRODUCT_MODULES);
  const { code } = await parseParams(ctx, productGet);
  const product = await getProduct(code);
  if (!product) throw new HttpError(404, 'ไม่พบรหัสอะไหล่ ' + code);
  const card = await productStockCard(code);
  return NextResponse.json({ product: (await canSeeCost(user)) ? product : withoutCost(product), card });
});
