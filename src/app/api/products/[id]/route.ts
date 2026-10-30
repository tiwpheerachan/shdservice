import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseParams, requireView, HttpError, PRODUCT_MODULES } from '@/server/auth';
import { productGet, STOCK_CARD_PAGE } from '@/server/contract/stock';
import { product } from '@/db/schema';
import { rowByUuid } from '@/server/ids';
import { canSeeCost, getProduct, productStockCard, productStockCardTotal, withoutCost } from '@/server/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Product detail + the newest page of its stock card (product-detail modal), by the part's uuid. */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireView(req, PRODUCT_MODULES);
  const { id } = await parseParams(ctx, productGet); // not a uuid → 404 ไม่พบอะไหล่
  const code = (await rowByUuid(product, id, 'อะไหล่')).productCode ?? '';
  const found = await getProduct(code);
  if (!found) throw new HttpError(404, 'ไม่พบอะไหล่');
  // the newest page only (a busy part has hundreds of lines) — the dialog's โหลดเพิ่ม reads /products/{id}/card
  const [card, cardTotal] = await Promise.all([
    productStockCard(code, { limit: STOCK_CARD_PAGE }),
    productStockCardTotal(code),
  ]);
  return NextResponse.json({ product: (await canSeeCost(user)) ? found : withoutCost(found), card, cardTotal });
});
