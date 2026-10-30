import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan } from '@/server/auth';
import { jobRepair } from '@/server/contract/jobs';
import { saveRepair, jobNoOf } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireCan(req, 'Job Repair', 'edit');
  const no = await jobNoOf((await parseParams(ctx, jobRepair)).id);
  const body = await parseBody(req, jobRepair);
  // the page's shared job sections are แก้ไขข้อมูลงาน's (PATCH /api/jobs/{id})
  if (body.job) await requireCan(req, 'Job Management', 'edit');
  const job = await saveRepair(no, body, user.pk);
  return NextResponse.json({ ok: true, job });
});
