import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan } from '@/server/auth';
import { jobOutsource } from '@/server/contract/jobs';
import { saveOutsource, type OutsourceInput } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, 'Job Repair', 'edit');
  const { no } = await parseParams(ctx, jobOutsource);
  const body = await parseBody(req, jobOutsource);
  // the parsed body; the service's own type predates the contract (it reads null as none) — the old readJson<T> cast
  const job = await saveOutsource(decodeURIComponent(no), body as OutsourceInput, user.userId);
  return NextResponse.json({ ok: true, job });
});
