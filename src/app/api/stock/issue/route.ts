import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan, HttpError } from '@/server/auth';
import { stockIssue } from '@/server/contract/stock';
import { idempotent } from '@/server/idempotency';
import { issueForJob, issueForSaleOrder, issueOther, returnFromJob } from '@/server/services/stock';
import { listStaff } from '@/server/services/users';
import { cleanCode } from '@/lib/validation';
import { STORE_LOCATION_NAME } from '@/lib/status-ids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ตัดจ่ายอะไหล่ → WHO document (type 3 / 4 / 5); type "return" → WHI รับคืนจากการเบิก (type 2). */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, 'Product Pick Stock', 'add');
  return idempotent(req, user.pk, async () =>
    NextResponse.json({ ok: true, ...(await issue(req, user.pk)) }, { status: 201 }),
  );
});

async function issue(req: NextRequest, userId: number) {
  const body = await parseBody(req, stockIssue); // issueSchema
  const b = { ...body, ref: cleanCode(body.ref), remark: body.remark ?? undefined };
  // จ่ายออกอื่นๆ takes parts OUT of the good-stock store: the store is never where they go
  if (b.type === 'other' && b.payTo === STORE_LOCATION_NAME) {
    const msg = `จ่ายออกอื่นๆ ต้องเลือกผู้รับ — จ่ายให้ "${STORE_LOCATION_NAME}" (คลังต้นทาง) ไม่ได้`;
    throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง 1 ช่อง', { fields: { payTo: msg } });
  }
  // จ่ายให้ (จ่ายออกอื่นๆ only — a job / sale-order / return movement stores none: its document is the reference):
  // the pick page's list, a current staff member
  if (b.type === 'other' && !(await listStaff()).some((s) => s.name === b.payTo)) {
    const msg = `ไม่พบ "${b.payTo}" ในรายชื่อ — เลือกผู้รับจากรายการ`;
    throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง 1 ช่อง', { fields: { payTo: msg } });
  }
  if (b.type === 'job') {
    if (!b.ref) throw new HttpError(400, 'ต้องระบุหมายเลขงาน');
    // every request issued → the job's status moves in the same transaction (issueForJob)
    return issueForJob(
      {
        jobNo: b.ref,
        remark: b.remark,
        payTo: b.payTo,
        lines: b.lines.map((l) => ({ logId: l.logId ?? '', qty: Number(l.qty) })),
      },
      userId,
    );
  }
  if (b.type === 'sale') {
    if (!b.ref) throw new HttpError(400, 'ต้องระบุเลขใบสั่งขาย');
    return issueForSaleOrder(
      {
        soNo: b.ref,
        remark: b.remark,
        payTo: b.payTo,
        lines: b.lines.map((l) => ({ dtId: l.dtId ?? '', qty: Number(l.qty) })),
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
        lines: b.lines.map((l) => ({ logId: l.logId ?? '', qty: Number(l.qty) })),
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
