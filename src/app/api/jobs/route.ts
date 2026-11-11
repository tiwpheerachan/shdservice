import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan } from '@/server/auth';
import { jobCreate } from '@/server/contract/jobs';
import { idempotent } from '@/server/idempotency';
import { createJob } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** เปิดงานใหม่ */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, 'Job Management', 'add');
  return idempotent(req, user.pk, async () => {
    const body = await parseBody(req, jobCreate);
    const job = await createJob(body, user.pk);
    return NextResponse.json({ ok: true, job }, { status: 201 });
  });
});
