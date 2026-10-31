import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseParams, parseQuery, requireView, PRODUCT_MODULES } from '@/server/auth';
import { productCard, STOCK_CARD_PAGE } from '@/server/contract/stock';
import { product } from '@/db/schema';
import { rowByUuid } from '@/server/ids';
import { productStockCard, productStockCardTotal } from '@/server/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The next page of a part's stock card (the product dialog's โหลดเพิ่ม), by the part's uuid. */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await requireView(req, PRODUCT_MODULES);
  const { id } = await parseParams(ctx, productCard);
  const { offset = 0 } = parseQuery(req, productCard);
  const code = (await rowByUuid(product, id, 'อะไหล่')).productCode ?? '';
  const [card, total] = await Promise.all([
    productStockCard(code, { offset, limit: STOCK_CARD_PAGE }),
    productStockCardTotal(code),
  ]);
  return NextResponse.json({ card, total });
});
