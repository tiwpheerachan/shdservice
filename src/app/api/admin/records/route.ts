import { NextResponse, type NextRequest } from 'next/server';
import { handle, requireAdmin, requireCan, readJson, HttpError } from '@/server/auth';
import { setRecordStatus, RECORD_MODULES, type RecordTable } from '@/server/services/records';
import { isRecordStatus, RS, type RecordStatus } from '@/server/record-status';
import { refuseSelf, setUserDeleted } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = { table?: string; id?: string | number; status?: string; deleted?: boolean };

/**
 * Change a record's record_status: ACTIVE / INACTIVE / DELETED (soft delete —
 * nothing is ever removed). Accepts `status`, or the older `deleted` boolean.
 * Permission: DELETED needs `del` on the table's module (users / masters: admin);
 * ACTIVE ↔ INACTIVE needs `edit`.
 */
export const POST = handle(async (req: NextRequest) => {
  const body = await readJson<Body>(req);
  const table = String(body.table ?? '') as RecordTable;
  const id = body.id;
  if (id === undefined || id === null || id === '') throw new HttpError(400, 'id required');
  const rs: RecordStatus = isRecordStatus(body.status) ? body.status : body.deleted === true ? RS.DELETED : RS.ACTIVE;

  if (table === 'users') {
    const me = await requireAdmin(req);
    if (rs !== RS.ACTIVE) refuseSelf(Number(id), me.userId); // never disable / delete your own account
    // ลบ / กู้คืน: users.ts writes the audit line with the person's name ("ลบผู้ใช้ สมชาย ใจดี"); กู้คืน
    // (ACTIVE / deleted:false) brings the account back INACTIVE — access returns only through คืนสิทธิ์
    if (rs === RS.INACTIVE) await setRecordStatus('users', Number(id), rs, me.userId);
    else await setUserDeleted(Number(id), rs === RS.DELETED, me.userId);
    return NextResponse.json({ ok: true, status: rs === RS.ACTIVE ? RS.INACTIVE : rs });
  }
  const permModule = RECORD_MODULES[table];
  if (permModule === undefined) throw new HttpError(400, `table not allowed: ${table}`);
  const user =
    permModule === null
      ? await requireAdmin(req)
      : await requireCan(req, permModule, rs === RS.DELETED ? 'del' : 'edit');
  await setRecordStatus(table, id, rs, user.userId);
  return NextResponse.json({ ok: true, status: rs });
});
