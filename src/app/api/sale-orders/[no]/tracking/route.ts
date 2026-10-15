import { NextResponse, type NextRequest } from 'next/server';
import { handle, requireCan, readJson } from '@/server/auth';
import { setTracking } from '@/server/services/sale-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, 'Sale Order', 'edit');
  const { no } = await ctx.params;
  const body = await readJson<{ tracking?: unknown }>(req);
  // checked in setTracking against the number stored now (trackingSchema — an unchanged legacy one passes)
  const order = await setTracking(decodeURIComponent(no), String(body.tracking ?? ''), user.userId);
  return NextResponse.json({ ok: true, order });
});
