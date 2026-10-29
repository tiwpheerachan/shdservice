import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseQuery, requireCan, requireUser } from '@/server/auth';
import { address, addressCreate } from '@/server/contract/misc';
import { idempotent } from '@/server/idempotency';
import { addSubDistrict, listDistricts, listProvinces, listSubDistricts } from '@/server/services/customers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cascading address lists: ?level=province | district&city= | subdistrict&district= */
export const GET = handle(async (req: NextRequest) => {
  await requireUser(req);
  const q = parseQuery(req, address);
  // a missing / non-uuid id: no rows
  if (q.level === 'district') return NextResponse.json({ rows: await listDistricts(q.city) });
  if (q.level === 'subdistrict') return NextResponse.json({ rows: await listSubDistricts(q.district) });
  return NextResponse.json({ rows: await listProvinces() });
});

/** "+ เพิ่มชื่อ" แขวง / ตำบล (customer form) — Customer edit */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, 'Customer', 'edit');
  const body = await parseBody(req, addressCreate);
  return idempotent(req, user.userId, async () =>
    NextResponse.json({ ok: true, row: await addSubDistrict(body, user.userId) }, { status: 201 }),
  );
});
