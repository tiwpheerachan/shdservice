import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireCan } from '@/server/auth';
import { jobOutsource } from '@/server/contract/jobs';
import { saveOutsource, jobNoOf } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireCan(req, 'Job Repair', 'edit');
  const no = await jobNoOf((await parseParams(ctx, jobOutsource)).id);
  const body = await parseBody(req, jobOutsource);
  // the page's shared job sections are แก้ไขข้อมูลงาน's (PATCH /api/jobs/{id})
  if (body.job) await requireCan(req, 'Job Management', 'edit');
  const job = await saveOutsource(no, body, user.pk);
  return NextResponse.json({ ok: true, job });
});
