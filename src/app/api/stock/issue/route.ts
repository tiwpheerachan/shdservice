import { NextResponse, type NextRequest } from 'next/server';
import { handle, requireCan, readJson, HttpError } from '@/server/auth';
import { idempotent } from '@/server/idempotency';
import { issueForJob, issueForSaleOrder, issueOther, returnFromJob } from '@/server/services/stock';
import { markPartsIssued } from '@/server/services/jobs';
import { assertValid } from '@/server/validate';
import { issueSchema } from '@/lib/validation/stock';

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
  const b = assertValid(issueSchema, await readJson(req));
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
      payTo: b.payTo ?? '',
      remark: b.remark,
      lines: b.lines.map((l) => ({ code: String(l.code ?? ''), qty: Number(l.qty) })),
    },
    userId,
  );
}
