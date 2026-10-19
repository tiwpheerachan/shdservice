import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan } from '@/server/auth';
import { saleOrderSave } from '@/server/contract/sales';
import { idempotent } from '@/server/idempotency';
import { saveSaleOrder } from '@/server/services/sale-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest) => {
  // before the permission check: add or edit depends on `no`
  const body = await parseBody(req, saleOrderSave);
  const user = await requireCan(req, 'Sale Order', body.no ? 'edit' : 'add');
  return idempotent(req, user.userId, async () => {
    const order = await saveSaleOrder(body, user);
    return NextResponse.json({ ok: true, order }, { status: body.no ? 200 : 201 });
  });
});
