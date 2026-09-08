import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allowed tables and their primary-key column. Only these can be soft-deleted.
const PK: Record<string, string> = {
  users: "id",
  jobs: "no",
  quotations: "no",
  sale_orders: "no",
  customers: "code",
  products: "sysCode",
  models: "code",
  movements: "id",
  categories: "id",
  manufacturers: "id",
  colors: "id",
  job_types: "id",
  product_types: "id",
  symptoms: "id",
  permissions: "id",
};

/**
 * Soft-delete or restore a record: sets the `deleted` flag instead of removing
 * the row, so it can be recovered from each list's "รายการที่ลบ" view.
 */
export async function POST(req: NextRequest) {
  const me = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { table?: string; id?: string | number; deleted?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const table = String(body.table ?? "");
  const pk = PK[table];
  const id = body.id;
  if (!pk) return NextResponse.json({ error: `table not allowed: ${table}` }, { status: 400 });
  if (id === undefined || id === null || id === "")
    return NextResponse.json({ error: "id required" }, { status: 400 });

  let db;
  try {
    db = supabaseAdmin();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server database is not configured" },
      { status: 503 }
    );
  }

  const { error } = await db
    .from(table)
    .update({ deleted: body.deleted === true })
    .eq(pk, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
