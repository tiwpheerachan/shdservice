import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan } from '@/server/auth';
import { stockReceive } from '@/server/contract/stock';
import { idempotent } from '@/server/idempotency';
import { receiveStock } from '@/server/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** รับเข้าอะไหล่ → WHI document. */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, 'Product Receive Stock', 'add');
  return idempotent(req, user.userId, async () => {
    const body = await parseBody(req, stockReceive); // receiveSchema
    const r = await receiveStock(body, user.userId);
    return NextResponse.json({ ok: true, ...r }, { status: 201 });
  });
});
