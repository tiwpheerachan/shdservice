import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan } from '@/server/auth';
import { jobSwapRefund } from '@/server/contract/jobs';
import { saveSwapRefund } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, 'Job Management', 'edit');
  const { no } = await parseParams(ctx, jobSwapRefund);
  const body = await parseBody(req, jobSwapRefund);
  const job = await saveSwapRefund(no, body, user.userId);
  return NextResponse.json({ ok: true, job });
});
