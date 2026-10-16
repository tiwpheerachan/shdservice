import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseQuery, requireView, JOB_MODULES } from '@/server/auth';
import { customerLookup } from '@/server/contract/sales';
import { rateLimit } from '@/server/rate-limit';
import { getCustomerByCode, listCustomers } from '@/server/services/customers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Find customers by code / tax id / name / phone (job & quotation forms). */
export const GET = handle(async (req: NextRequest) => {
  await rateLimit(req, 'lookup', 120);
  await requireView(req, ['Customer', ...JOB_MODULES, 'Quotation', 'Sale Order']);
  const q = (parseQuery(req, customerLookup).q ?? '').trim();
  if (!q) return NextResponse.json({ rows: [] });
  const exact = await getCustomerByCode(q);
  if (exact) return NextResponse.json({ rows: [exact] });
  const rows = await listCustomers({ q, limit: 20 });
  return NextResponse.json({ rows });
});
