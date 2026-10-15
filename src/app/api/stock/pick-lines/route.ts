import { NextResponse, type NextRequest } from 'next/server';
import { handle, HttpError, requireView } from '@/server/auth';
import {
  assertJobOpenForIssue,
  listPartRequests,
  listSaleOrderPickLines,
  listReturnableLines,
} from '@/server/services/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lines to issue/return for a reference document: ?type=job|sale|return&ref=J26…/SO26… */
export const GET = handle(async (req: NextRequest) => {
  await requireView(req, ['Product Pick Stock']);
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type');
  const ref = (sp.get('ref') ?? '').trim();
  if (!ref) throw new HttpError(400, 'ref required');
  if (type === 'job') {
    await assertJobOpenForIssue(ref); // a closed / cancelled job has nothing left to issue
    return NextResponse.json({ rows: await listPartRequests(ref, true) });
  }
  if (type === 'sale') return NextResponse.json({ rows: await listSaleOrderPickLines(ref) });
  if (type === 'return') return NextResponse.json({ rows: await listReturnableLines(ref) });
  throw new HttpError(400, 'type must be job, sale or return');
});
