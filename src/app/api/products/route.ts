import { NextResponse, type NextRequest } from 'next/server';
import { handle, requireCan, readJson } from '@/server/auth';
import { canSeeCost, productsWithMfgCode, saveProduct, withoutCost, type ProductInput } from '@/server/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Create or update a spare part (product + on-hand row + models). */
export const POST = handle(async (req: NextRequest) => {
  const body = await readJson<ProductInput>(req);
  const user = await requireCan(req, 'Product', body.sysCode ? 'edit' : 'add');
  // ราคาทุน: only a user who may see it sets it (an add-only role: a new part starts at 0) or gets it back
  const cost = await canSeeCost(user);
  const row = await saveProduct(cost ? body : { ...body, capitalPrice: undefined }, user.userId);
  // the same vendor code on another product: saved anyway (legacy has real pairs), the form warns
  const sameMfgCode = await productsWithMfgCode(row.mfgCode, row.sysCode);
  return NextResponse.json({ ok: true, row: cost ? row : withoutCost(row), sameMfgCode });
});
