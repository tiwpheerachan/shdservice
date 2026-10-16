import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan, requireView, JOB_MODULES } from '@/server/auth';
import { jobCallAdd, jobCalls } from '@/server/contract/jobs';
import { addCallLog, listCallLogs } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ no: string }> };

export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireView(req, JOB_MODULES);
  const { no } = await parseParams(ctx, jobCalls);
  return NextResponse.json({ rows: await listCallLogs(decodeURIComponent(no)) });
});

export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireCan(req, 'Job Management', 'edit');
  const { no } = await parseParams(ctx, jobCallAdd);
  const body = await parseBody(req, jobCallAdd); // callLogSchema
  return NextResponse.json({ ok: true, rows: await addCallLog(decodeURIComponent(no), body.detail, user.userId) });
});
