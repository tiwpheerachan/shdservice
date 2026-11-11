import { NextResponse, type NextRequest } from 'next/server';
import { handle, HttpError, parseParams, requireView } from '@/server/auth';
import { quotationGet } from '@/server/contract/sales';
import { getQuotation, quotationNoOf } from '@/server/services/quotations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await requireView(req, ['Quotation']);
  const { id } = await parseParams(ctx, quotationGet); // not a uuid (an old number link) → 404
  const no = await quotationNoOf(id);
  const quotation = no && (await getQuotation(no));
  if (!quotation) throw new HttpError(404, 'ไม่พบใบเสนอราคา');
  return NextResponse.json({ quotation });
});
