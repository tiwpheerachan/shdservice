import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan, requireView, JOB_MODULES } from '@/server/auth';
import { jobGet, jobUpdate } from '@/server/contract/jobs';
import { getJob, jobNotFound, updateJob, type JobInput } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ no: string }> };

/** Job detail for every job screen. */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireView(req, [...JOB_MODULES, 'Quotation']);
  const { no } = await parseParams(ctx, jobGet);
  const job = await getJob(decodeURIComponent(no).trim().toUpperCase());
  if (!job) throw jobNotFound(no);
  return NextResponse.json({ job });
});

/** แก้ไขข้อมูลงาน */
export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireCan(req, 'Job Management', 'edit');
  const { no } = await parseParams(ctx, jobUpdate);
  const body = await parseBody(req, jobUpdate);
  // the parsed body; the service's own type predates the contract (it reads null as none) — the old readJson<T> cast
  const job = await updateJob(decodeURIComponent(no), body as JobInput, user.userId);
  return NextResponse.json({ ok: true, job });
});
