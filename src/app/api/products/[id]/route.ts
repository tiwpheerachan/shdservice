import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseParams, requireView, HttpError, PRODUCT_MODULES } from '@/server/auth';
import { productGet } from '@/server/contract/stock';
import { product } from '@/db/schema';
import { pkOf } from '@/server/ids';
import { canSeeCost, getProduct, productStockCard, withoutCost } from '@/server/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Product detail + stock card (product-detail modal), by the part's uuid. */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireView(req, PRODUCT_MODULES);
  const { id } = await parseParams(ctx, productGet); // not a uuid → 404 ไม่พบอะไหล่
  const code = await pkOf(product, product.productCode, id, 'อะไหล่');
  const found = await getProduct(code);
  if (!found) throw new HttpError(404, 'ไม่พบอะไหล่');
  const card = await productStockCard(code);
  return NextResponse.json({ product: (await canSeeCost(user)) ? found : withoutCost(found), card });
});
