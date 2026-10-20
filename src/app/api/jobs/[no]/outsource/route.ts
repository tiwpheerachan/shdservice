import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan } from '@/server/auth';
import { jobOutsource } from '@/server/contract/jobs';
import { saveOutsource } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, 'Job Repair', 'edit');
  const { no } = await parseParams(ctx, jobOutsource);
  const body = await parseBody(req, jobOutsource);
  const job = await saveOutsource(no, body, user.userId);
  return NextResponse.json({ ok: true, job });
});
