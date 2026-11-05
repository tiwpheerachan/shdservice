import { NextResponse, type NextRequest } from 'next/server';
import { handle, requireView } from '@/server/auth';
import { saleOrdersToPick } from '@/server/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** จ่ายออกตามใบสั่งขาย's reference list: approved sale orders that still have a line to issue. */
export const GET = handle(async (req: NextRequest) => {
  await requireView(req, ['Product Pick Stock']);
  return NextResponse.json({ rows: await saleOrdersToPick() });
});
