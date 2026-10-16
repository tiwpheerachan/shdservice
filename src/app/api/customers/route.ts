import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan } from '@/server/auth';
import { customerSave } from '@/server/contract/sales';
import { idempotent } from '@/server/idempotency';
import { saveCustomer, type CustomerInput } from '@/server/services/customers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Create (add) or update (edit) a customer. */
export const POST = handle(async (req: NextRequest) => {
  // before the permission check: add or edit depends on `code`
  const body = await parseBody(req, customerSave);
  const user = await requireCan(req, 'Customer', body.code ? 'edit' : 'add');
  return idempotent(req, user.userId, async () => {
    // the parsed body; the service's own type predates the contract (it reads null as none) — the old readJson<T> cast
    const row = await saveCustomer(body as CustomerInput, user.userId);
    return NextResponse.json({ ok: true, row }, { status: body.code ? 200 : 201 });
  });
});
