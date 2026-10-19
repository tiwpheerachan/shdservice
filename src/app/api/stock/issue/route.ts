import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan, HttpError } from '@/server/auth';
import { stockIssue } from '@/server/contract/stock';
import { idempotent } from '@/server/idempotency';
import { issueForJob, issueForSaleOrder, issueOther, returnFromJob } from '@/server/services/stock';
import { markPartsIssued } from '@/server/services/jobs';
import { listStaff } from '@/server/services/users';
import { cleanCode } from '@/lib/validation';
import { STORE_LOCATION_NAME } from '@/lib/status-ids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ตัดจ่ายอะไหล่ → WHO document (type 3 / 4 / 5); type "return" → WHI รับคืนจากการเบิก (type 2). */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, 'Product Pick Stock', 'add');
  return idempotent(req, user.userId, async () =>
    NextResponse.json({ ok: true, ...(await issue(req, user.userId)) }, { status: 201 }),
  );
});

async function issue(req: NextRequest, userId: number) {
  const body = await parseBody(req, stockIssue); // issueSchema
  const b = { ...body, ref: cleanCode(body.ref), remark: body.remark ?? undefined };
  // จ่ายให้ / รับคืนจาก: the pick page's list — the good-stock store or a current staff member
  if (b.payTo !== STORE_LOCATION_NAME && !(await listStaff()).some((s) => s.name === b.payTo)) {
    const msg = `ไม่พบ "${b.payTo}" ในรายชื่อ — เลือก${b.type === 'return' ? 'ผู้คืน' : 'ผู้รับ'}จากรายการ`;
    throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง 1 ช่อง', { fields: { payTo: msg } });
  }
  if (b.type === 'job') {
    if (!b.ref) throw new HttpError(400, 'ต้องระบุหมายเลขงาน');
    const r = await issueForJob(
      {
        jobNo: b.ref,
        remark: b.remark,
        payTo: b.payTo,
        lines: b.lines.map((l) => ({ logId: Number(l.logId), qty: Number(l.qty) })),
      },
      userId,
    );
    if (r.allGranted) await markPartsIssued(b.ref, userId);
    return r;
  }
  if (b.type === 'sale') {
    if (!b.ref) throw new HttpError(400, 'ต้องระบุเลขใบสั่งขาย');
    return issueForSaleOrder(
      {
        soNo: b.ref,
        remark: b.remark,
        payTo: b.payTo,
        lines: b.lines.map((l) => ({ dtId: Number(l.dtId), qty: Number(l.qty) })),
      },
      userId,
    );
  }
  if (b.type === 'return') {
    if (!b.ref) throw new HttpError(400, 'ต้องระบุหมายเลขงาน');
    return returnFromJob(
      {
        jobNo: b.ref,
        remark: b.remark,
        from: b.payTo,
        lines: b.lines.map((l) => ({ logId: Number(l.logId), qty: Number(l.qty) })),
      },
      userId,
    );
  }
  return issueOther(
    {
      payTo: b.payTo,
      remark: b.remark,
      lines: b.lines.map((l) => ({ code: String(l.code ?? ''), qty: Number(l.qty) })),
    },
    userId,
  );
}
