import { NextResponse, type NextRequest } from "next/server";
import { handle, requireAdmin, requireCan, readJson, HttpError } from "@/server/auth";
import { setUserDeleted } from "@/server/services/users";
import { setRecordDeleted, RECORD_MODULES, type RecordTable } from "@/server/services/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Soft-delete or restore a record. The legacy DB has no `deleted` flag; each
 * table has its own convention (is_active=false, job status 0 …) implemented in
 * services/records.ts. Permission: `del` on the table's module (users: admin).
 */
export const POST = handle(async (req: NextRequest) => {
  const body = await readJson<{ table?: string; id?: string | number; deleted?: boolean }>(req);
  const table = String(body.table ?? "") as RecordTable;
  const id = body.id;
  if (id === undefined || id === null || id === "") throw new HttpError(400, "id required");
  const deleted = body.deleted === true;

  if (table === "users") {
    await requireAdmin(req);
    await setUserDeleted(Number(id), deleted);
    return NextResponse.json({ ok: true });
  }
  const module = RECORD_MODULES[table];
  if (module === undefined) throw new HttpError(400, `table not allowed: ${table}`);
  const user = module === null ? await requireAdmin(req) : await requireCan(req, module, "del");
  await setRecordDeleted(table, id, deleted, user.userId);
  return NextResponse.json({ ok: true });
});
