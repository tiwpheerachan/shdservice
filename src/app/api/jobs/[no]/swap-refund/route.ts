import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan } from '@/server/auth';
import { jobSwapRefund } from '@/server/contract/jobs';
import { saveSwapRefund, type SwapRefundInput } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, 'Job Management', 'edit');
  const { no } = await parseParams(ctx, jobSwapRefund);
  const body = await parseBody(req, jobSwapRefund);
  // the parsed body; the service's own type predates the contract (it reads null as none) — the old readJson<T> cast
  const job = await saveSwapRefund(decodeURIComponent(no), body as SwapRefundInput, user.userId);
  return NextResponse.json({ ok: true, job });
});
