import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { HttpError } from '@/server/http-error';
import { parseHeaders } from '@/server/auth';
import { IDEMPOTENCY } from '@/server/contract/common';

/**
 * Idempotency-Key on create POSTs: the same key from the same user on the same route runs `fn` once and every repeat
 * gets the stored answer instead of a second document. A repeat while the first still runs → 409. Only a 2xx answer
 * is stored: a refused request created nothing, so its key is released. No header → `fn` just runs.
 */
let lastPurge = 0;

export async function idempotent(req: NextRequest, userPk: number, fn: () => Promise<Response>): Promise<Response> {
  // trimmed; over 100 → 400 "Idempotency-Key ยาวเกินไป" (the header as src/server/contract declares it)
  const key = parseHeaders(req, IDEMPOTENCY)['Idempotency-Key'];
  if (!key) return fn();
  const route = `${req.method} ${req.nextUrl.pathname}`.slice(0, 200);

  // purge as we go — at most once a minute per process, not on every keyed POST
  if (Date.now() - lastPurge > 60_000) {
    lastPurge = Date.now();
    await db.execute(sql`DELETE FROM idempotency_key WHERE created_at < now() - interval '24 hours'`);
  }
  // claim the key; a claim left unfinished > 2 min (the process died mid-request) may be taken over
  const claimed = await db.execute(sql`
    INSERT INTO idempotency_key (app_user_pk, key, route) VALUES (${userPk}, ${key}, ${route})
    ON CONFLICT (app_user_pk, key) DO UPDATE SET created_at = now()
      WHERE idempotency_key.response IS NULL AND idempotency_key.route = EXCLUDED.route
        AND idempotency_key.created_at < now() - interval '2 minutes'
    RETURNING 1`);
  if (!claimed.rows.length) {
    const [hit] = (
      await db.execute<{ route: string; status: number | null; response: unknown }>(
        sql`SELECT route, status, response FROM idempotency_key WHERE app_user_pk = ${userPk} AND key = ${key}`,
      )
    ).rows;
    if (hit && hit.route !== route) throw new HttpError(422, 'Idempotency-Key นี้ใช้กับคำขออื่นไปแล้ว');
    if (!hit || hit.response === null)
      throw new HttpError(409, 'กำลังบันทึกรายการนี้อยู่ กรุณารอสักครู่แล้วลองอีกครั้ง');
    return NextResponse.json(hit.response, { status: hit.status ?? 200, headers: { 'Idempotent-Replayed': 'true' } });
  }

  const release = () =>
    db.execute(sql`DELETE FROM idempotency_key WHERE app_user_pk = ${userPk} AND key = ${key} AND response IS NULL`);
  let res: Response;
  try {
    res = await fn();
  } catch (e) {
    await release().catch(() => undefined); // the request's own error is the one to report
    throw e;
  }
  if (!res.ok) {
    await release();
    return res;
  }
  const body: unknown = await res.clone().json();
  await db.execute(
    sql`UPDATE idempotency_key SET status = ${res.status}, response = ${JSON.stringify(body)}::jsonb WHERE app_user_pk = ${userPk} AND key = ${key}`,
  );
  return res;
}
