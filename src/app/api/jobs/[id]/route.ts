import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan, requireView, JOB_MODULES } from '@/server/auth';
import { jobGet, jobUpdate } from '@/server/contract/jobs';
import { getJob, jobNoOf, jobNotFound, updateJob } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireView(req, [...JOB_MODULES, 'Quotation']);
  const no = await jobNoOf((await parseParams(ctx, jobGet)).id);
  const job = await getJob(no, user.pk); // figuresLocked is the viewer's
  if (!job) throw jobNotFound(no);
  return NextResponse.json({ job });
});

/** แก้ไขข้อมูลงาน */
export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireCan(req, 'Job Management', 'edit');
  const no = await jobNoOf((await parseParams(ctx, jobUpdate)).id);
  const body = await parseBody(req, jobUpdate);
  const job = await updateJob(no, body, user.pk);
  return NextResponse.json({ ok: true, job });
});
