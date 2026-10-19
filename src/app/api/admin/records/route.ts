import { NextResponse, type NextRequest } from 'next/server';
import { can, handle, parseBody, requireAdmin, requireCan } from '@/server/auth';
import { recordStatus } from '@/server/contract/admin';
import { setRecordStatus, RECORD_MODULES } from '@/server/services/records';
import { RS, type RecordStatus } from '@/server/record-status';
import { refuseSelf, setUserDeleted } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Change a record's record_status: ACTIVE / INACTIVE / DELETED (soft delete —
 * nothing is ever removed). Accepts `status`, or the older `deleted` boolean.
 * Permission: DELETED needs `del` on the table's module (users / masters: admin);
 * ACTIVE ↔ INACTIVE needs `edit`; out of DELETED (กู้คืน) needs `del` as well. A missing id / unknown
 * table is a 400 before the permission check.
 */
export const POST = handle(async (req: NextRequest) => {
  const { table, id, status, deleted } = await parseBody(req, recordStatus);
  const rs: RecordStatus = status ?? (deleted === true ? RS.DELETED : RS.ACTIVE);

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
  const user =
    permModule === null
      ? await requireAdmin(req)
      : await requireCan(req, permModule, rs === RS.DELETED ? 'del' : 'edit');
  // out of DELETED (กู้คืน) is the reverse of a delete → `del` too (checked against the locked row)
  await setRecordStatus(table, id, rs, user.userId, permModule === null || (await can(user, permModule, 'del')));
  return NextResponse.json({ ok: true, status: rs });
});
