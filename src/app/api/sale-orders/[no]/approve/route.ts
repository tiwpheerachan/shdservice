import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan } from '@/server/auth';
import { saleOrderApprove } from '@/server/contract/sales';
import { approveSaleOrder } from '@/server/services/sale-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** อนุมัติ / ปฏิเสธ / ส่งกลับแก้ไข — approval issues stock (WHO type 4). */
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, 'Sale Order', 'edit');
  const { no } = await parseParams(ctx, saleOrderApprove);
  const body = await parseBody(req, saleOrderApprove); // approveSchema
  const order = await approveSaleOrder(no, body.decision, body.remark ?? '', user, body.version);
  return NextResponse.json({ ok: true, order });
});
