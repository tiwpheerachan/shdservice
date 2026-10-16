import { NextResponse, type NextRequest } from 'next/server';
import { handle, HttpError, parseParams, requireView } from '@/server/auth';
import { quotationGet } from '@/server/contract/sales';
import { getQuotation } from '@/server/services/quotations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  await requireView(req, ['Quotation']);
  const { no } = await parseParams(ctx, quotationGet);
  const quotation = await getQuotation(decodeURIComponent(no).trim().toUpperCase());
  if (!quotation) throw new HttpError(404, 'ไม่พบใบเสนอราคา ' + no);
  return NextResponse.json({ quotation });
});
