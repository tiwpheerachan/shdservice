import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseQuery, requireView, JOB_MODULES } from '@/server/auth';
import { jobSuggestionsGet } from '@/server/contract/jobs';
import { jobSuggestions } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest) => {
  await requireView(req, JOB_MODULES);
  const { field, q } = parseQuery(req, jobSuggestionsGet);
  return NextResponse.json({ values: await jobSuggestions(field, q) });
});
