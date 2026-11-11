import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan } from '@/server/auth';
import { productSave } from '@/server/contract/stock';
import { idempotent } from '@/server/idempotency';
import { canSeeCost, productsWithMfgCode, saveProduct, withoutCost } from '@/server/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Create or update a spare part (product + on-hand row + models). */
export const POST = handle(async (req: NextRequest) => {
  // before the permission check: add or edit depends on `sysCode`
  const body = await parseBody(req, productSave);
  const user = await requireCan(req, 'Product', body.sysCode ? 'edit' : 'add');
  // ราคาทุน: only a user who may see it sets it (an add-only role: a new part starts at 0) or gets it back
  const cost = await canSeeCost(user);
  return idempotent(req, user.pk, async () => {
    const row = await saveProduct(cost ? body : { ...body, capitalPrice: undefined }, user.pk);
    // the same vendor code on another product: saved anyway (legacy has real pairs), the form warns
    const sameMfgCode = await productsWithMfgCode(row.mfgCode, row.sysCode);
    return NextResponse.json({ ok: true, row: cost ? row : withoutCost(row), sameMfgCode });
  });
});
