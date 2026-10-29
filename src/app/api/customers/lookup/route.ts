import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseQuery, requireView, JOB_MODULES } from '@/server/auth';
import { customerLookup } from '@/server/contract/sales';
import { rateLimit } from '@/server/rate-limit';
import { getCustomerByCode, getCustomerByUuid, listCustomers } from '@/server/services/customers';
import { isUuid } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Find customers by code / tax id / name / phone (job & quotation forms). */
export const GET = handle(async (req: NextRequest) => {
  await rateLimit(req, 'lookup', 120);
  const user = await requireView(req, ['Customer', ...JOB_MODULES, 'Quotation', 'Sale Order']);
  const query = parseQuery(req, customerLookup);
  const q = (query.q ?? '').trim();
  if (!q) return NextResponse.json({ rows: [] });
  // deleted customers (PDPA: erased on request) are System Admin's alone, and only when asked (the customers
  // page's ?edit=) — a picker never offers one
  const mode = user.isAdmin && query.deleted === 'all' ? 'all' : 'exclude';
  // a uuid: the customers page's ?edit= link (ADR 0008) — that customer or none, never a search
  if (isUuid(q)) {
    const hit = await getCustomerByUuid(q.toLowerCase(), mode);
    return NextResponse.json({ rows: hit ? [hit] : [] });
  }
  const exact = await getCustomerByCode(q, mode);
  if (exact) return NextResponse.json({ rows: [exact] });
  const rows = await listCustomers({ q, limit: 20 });
  return NextResponse.json({ rows });
});
