import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan } from '@/server/auth';
import { jobClose } from '@/server/contract/jobs';
import { closeJob, type CloseInput } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, 'Job Closing', 'edit');
  const { no } = await parseParams(ctx, jobClose);
  const body = await parseBody(req, jobClose);
  // the parsed body; the service's own type predates the contract (it reads null as none) — the old readJson<T> cast
  const job = await closeJob(decodeURIComponent(no), body as CloseInput, user.userId);
  return NextResponse.json({ ok: true, job });
});
