import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan } from '@/server/auth';
import { jobRepair } from '@/server/contract/jobs';
import { saveRepair } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, 'Job Repair', 'edit');
  const { no } = await parseParams(ctx, jobRepair);
  const body = await parseBody(req, jobRepair);
  const job = await saveRepair(decodeURIComponent(no), body, user.userId);
  return NextResponse.json({ ok: true, job });
});
