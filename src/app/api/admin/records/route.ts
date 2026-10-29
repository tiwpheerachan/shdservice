import { NextResponse, type NextRequest } from 'next/server';
import { can, handle, hasRight, HttpError, parseBody, requireAdmin, requireCan } from '@/server/auth';
import { clean } from '@/lib/validation';
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
 * ACTIVE ↔ INACTIVE needs `edit`; out of DELETED (กู้คืน) needs `del` as well (customers: System Admin only). A missing id / unknown
 * table is a 400 before the permission check.
 */
export const POST = handle(async (req: NextRequest) => {
  const { table, id, status, deleted, remark } = await parseBody(req, recordStatus);
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
      : // cancelling a sale order is its creator's own step (edit) — who else may is decided on the locked row
        // (creator / SO Approve / System Admin); every other delete needs `del`
        await requireCan(req, permModule, rs === RS.DELETED && table !== 'sale_orders' ? 'del' : 'edit');
  // ยกเลิกงาน / ใบเสนอราคา: why — on the audit line (ประวัติการแก้ไข); a sale order's is checked on its locked row
  if (rs === RS.DELETED && (table === 'jobs' || table === 'quotations') && !clean(remark))
    throw new HttpError(400, 'ระบุเหตุผลที่ยกเลิก', { fields: { remark: 'ระบุเหตุผลที่ยกเลิก' } });
  // out of DELETED (กู้คืน) is the reverse of a delete → `del` too (checked against the locked row);
  // a deleted customer (PDPA: erased on request) is System Admin's alone, as its list / lookup are
  await setRecordStatus(
    table,
    id,
    rs,
    user.userId,
    table === 'customers' ? user.isAdmin : permModule === null || (await can(user, permModule, 'del')),
    table !== 'sale_orders' || user.isAdmin || (await hasRight(user, 'SO Approve')),
    remark,
  );
  return NextResponse.json({ ok: true, status: rs });
});
