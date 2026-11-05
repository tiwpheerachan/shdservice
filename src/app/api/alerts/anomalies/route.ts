import { NextResponse, type NextRequest } from 'next/server';
import { handle, requireAdmin } from '@/server/auth';
import { anomalies } from '@/server/services/anomalies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — the bell's System Admin section: ค่าที่ไม่สมเหตุสมผล (counts + a few of each; report only) */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  return NextResponse.json(await anomalies(), { headers: { 'Cache-Control': 'no-store' } });
});
