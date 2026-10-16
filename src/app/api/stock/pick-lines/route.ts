import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseQuery, requireView } from '@/server/auth';
import { stockPickLines } from '@/server/contract/stock';
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
  const { ref, type } = parseQuery(req, stockPickLines); // 400 "ref required" / "type must be job, sale or return"
  if (type === 'job') {
    await assertJobOpenForIssue(ref); // a closed / cancelled job has nothing left to issue
    return NextResponse.json({ rows: await listPartRequests(ref, true) });
  }
  if (type === 'sale') return NextResponse.json({ rows: await listSaleOrderPickLines(ref) });
  return NextResponse.json({ rows: await listReturnableLines(ref) });
});
