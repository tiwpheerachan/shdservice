import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan } from '@/server/auth';
import { quotationSave } from '@/server/contract/sales';
import { idempotent } from '@/server/idempotency';
import { saveQuotation, type QuotationInput } from '@/server/services/quotations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest) => {
  // before the permission check: add or edit depends on `no`
  const body = await parseBody(req, quotationSave);
  const user = await requireCan(req, 'Quotation', body.no ? 'edit' : 'add');
  return idempotent(req, user.userId, async () => {
    // the parsed body; the service's own type predates the contract (it reads null as none) — the old readJson<T> cast
    const quotation = await saveQuotation(body as QuotationInput, user.userId);
    return NextResponse.json({ ok: true, quotation }, { status: body.no ? 200 : 201 });
  });
});
