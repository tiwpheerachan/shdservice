import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseQuery, requireUser } from '@/server/auth';
import { address } from '@/server/contract/misc';
import { listDistricts, listProvinces, listSubDistricts } from '@/server/services/customers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cascading address lists: ?level=province | district&city= | subdistrict&district= */
export const GET = handle(async (req: NextRequest) => {
  await requireUser(req);
  const q = parseQuery(req, address);
  // a missing id reads as 0 (no rows), as Number(null) always did
  if (q.level === 'district') return NextResponse.json({ rows: await listDistricts(Number(q.city ?? 0)) });
  if (q.level === 'subdistrict') return NextResponse.json({ rows: await listSubDistricts(Number(q.district ?? 0)) });
  return NextResponse.json({ rows: await listProvinces() });
});
