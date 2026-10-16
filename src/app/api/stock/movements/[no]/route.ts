import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseParams, requireView } from '@/server/auth';
import { stockMovementLines } from '@/server/contract/stock';
import { movementLines } from '@/server/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  await requireView(req, ['Product Onhand', 'Product Receive Stock', 'Product Pick Stock']);
  const { no } = await parseParams(ctx, stockMovementLines);
  return NextResponse.json({ rows: await movementLines(decodeURIComponent(no)) });
});
