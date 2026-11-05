import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseQuery, requireView, JOB_MODULES } from '@/server/auth';
import { jobChecksGet } from '@/server/contract/jobs';
import { jobChecks } from '@/server/services/job-checks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest) => {
  await requireView(req, JOB_MODULES);
  return NextResponse.json(await jobChecks(parseQuery(req, jobChecksGet)));
});
