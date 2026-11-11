import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan } from '@/server/auth';
import { jobAssign } from '@/server/contract/jobs';
import { assignJobs } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** จนท.รับมอบหมายงาน — assign engineer to many jobs. A job someone else has → 409 unless `takeOver: true`. */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, 'Job Assign', 'edit');
  const body = await parseBody(req, jobAssign); // assignSchema
  const n = await assignJobs(body.jobNos, body.engineerId, user.pk, body.takeOver === true);
  return NextResponse.json({ ok: true, assigned: n });
});
