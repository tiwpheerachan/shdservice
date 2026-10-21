import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan } from '@/server/auth';
import { jobClose } from '@/server/contract/jobs';
import { closeJob } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, 'Job Closing', 'edit');
  const { no } = await parseParams(ctx, jobClose);
  const body = await parseBody(req, jobClose);
  // the page's shared job sections are แก้ไขข้อมูลงาน's (PATCH /api/jobs/{no})
  if (body.job) await requireCan(req, 'Job Management', 'edit');
  const job = await closeJob(no, body, user.userId);
  return NextResponse.json({ ok: true, job });
});
