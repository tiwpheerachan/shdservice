import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan, requireView, JOB_MODULES } from '@/server/auth';
import { jobCallAdd, jobCalls } from '@/server/contract/jobs';
import { idempotent } from '@/server/idempotency';
import { addCallLog, jobNoOf, listCallLogs } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireView(req, JOB_MODULES);
  const no = await jobNoOf((await parseParams(ctx, jobCalls)).id);
  return NextResponse.json({ rows: await listCallLogs(no) });
});

export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireCan(req, 'Job Management', 'edit');
  const no = await jobNoOf((await parseParams(ctx, jobCallAdd)).id);
  const body = await parseBody(req, jobCallAdd); // callLogSchema
  return idempotent(req, user.userId, async () =>
    NextResponse.json({ ok: true, rows: await addCallLog(no, body.detail, user.userId) }),
  );
});
