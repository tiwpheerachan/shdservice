import { NextResponse, type NextRequest } from 'next/server';
import { can, handle, hasRight, HttpError, parseBody, requireAdmin, requireCan } from '@/server/auth';
import { clean } from '@/lib/validation';
import { recordStatus } from '@/server/contract/admin';
import { setRecordStatus, RECORD_MODULES } from '@/server/services/records';
import { RS, type RecordStatus } from '@/server/record-status';
import { refuseSelf, setUserDeleted } from '@/server/services/users';
import { isUuid } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Soft delete only. DELETED and กู้คืน need `del` on the table's module (customers: System Admin only), ACTIVE ↔ INACTIVE `edit`;
 * a missing id / unknown table is a 400 before the permission check. The `deleted` boolean is the older form of `status`.
 */
export const POST = handle(async (req: NextRequest) => {
  const { table, id, status, deleted, remark } = await parseBody(req, recordStatus);
  const rs: RecordStatus = status ?? (deleted === true ? RS.DELETED : RS.ACTIVE);

  if (table === 'users') {
    const me = await requireAdmin(req);
    // the user's uuid (ADR 0008): anything else names nobody
    if (!isUuid(id)) throw new HttpError(404, 'ไม่พบผู้ใช้');
    const uid = id.trim().toLowerCase();
    if (rs !== RS.ACTIVE) refuseSelf(uid, me.id); // never disable / delete your own account
    // ลบ / กู้คืน: users.ts writes the audit line with the person's name ("ลบผู้ใช้ สมชาย ใจดี"); กู้คืน
    // (ACTIVE / deleted:false) brings the account back INACTIVE — access returns only through คืนสิทธิ์
    if (rs === RS.INACTIVE) await setRecordStatus('users', uid, rs, me.pk);
    else await setUserDeleted(uid, rs === RS.DELETED, me.pk);
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
  // master data (models apart: their code) and customers come as the row's uuid (ADR 0008): anything else names no row
  const byUuid = table === 'customers' || (permModule === null && table !== 'models');
  if (byUuid && !isUuid(id)) throw new HttpError(404, table === 'customers' ? 'ไม่พบลูกค้า' : 'ไม่พบรายการนี้');
  // out of DELETED (กู้คืน) is the reverse of a delete → `del` too (checked against the locked row);
  // a deleted customer (PDPA: erased on request) is System Admin's alone, as its list / lookup are
  await setRecordStatus(
    table,
    byUuid ? id.trim().toLowerCase() : id,
    rs,
    user.pk,
    table === 'customers' ? user.isAdmin : permModule === null || (await can(user, permModule, 'del')),
    table !== 'sale_orders' || user.isAdmin || (await hasRight(user, 'SO Approve')),
    remark,
  );
  return NextResponse.json({ ok: true, status: rs });
});
