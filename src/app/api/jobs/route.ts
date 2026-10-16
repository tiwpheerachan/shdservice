import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan } from '@/server/auth';
import { jobCreate } from '@/server/contract/jobs';
import { idempotent } from '@/server/idempotency';
import { createJob, type JobInput } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** เปิดงานใหม่ */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, 'Job Management', 'add');
  return idempotent(req, user.userId, async () => {
    const body = await parseBody(req, jobCreate);
    // the parsed body; the service's own type predates the contract (it reads null as none) — the old readJson<T> cast
    const job = await createJob(body as JobInput, user.userId);
    return NextResponse.json({ ok: true, job }, { status: 201 });
  });
});
