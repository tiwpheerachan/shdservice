import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan } from '@/server/auth';
import { customerSave } from '@/server/contract/sales';
import { idempotent } from '@/server/idempotency';
import { saveCustomer } from '@/server/services/customers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest) => {
  // before the permission check: add or edit depends on `code`
  const body = await parseBody(req, customerSave);
  const user = await requireCan(req, 'Customer', body.code ? 'edit' : 'add');
  return idempotent(req, user.pk, async () => {
    const row = await saveCustomer(body, user.pk);
    return NextResponse.json({ ok: true, row }, { status: body.code ? 200 : 201 });
  });
});
