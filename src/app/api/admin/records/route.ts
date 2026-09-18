import { NextResponse, type NextRequest } from "next/server";
import { handle, requireAdmin, requireCan, readJson, HttpError } from "@/server/auth";
import { setRecordStatus, RECORD_MODULES, type RecordTable } from "@/server/services/records";
import { isRecordStatus, RS, type RecordStatus } from "@/server/record-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { table?: string; id?: string | number; status?: string; deleted?: boolean };

/**
 * Change a record's record_status: ACTIVE / INACTIVE / DELETED (soft delete —
 * nothing is ever removed). Accepts `status`, or the older `deleted` boolean.
 * Permission: DELETED needs `del` on the table's module (users / masters: admin);
 * ACTIVE ↔ INACTIVE needs `edit`.
 */
export const POST = handle(async (req: NextRequest) => {
  const body = await readJson<Body>(req);
  const table = String(body.table ?? "") as RecordTable;
  const id = body.id;
  if (id === undefined || id === null || id === "") throw new HttpError(400, "id required");
  const rs: RecordStatus = isRecordStatus(body.status) ? body.status : body.deleted === true ? RS.DELETED : RS.ACTIVE;

  if (table === "users") {
    const me = await requireAdmin(req);
    await setRecordStatus("users", Number(id), rs, me.userId);
    return NextResponse.json({ ok: true, status: rs });
  }
  const module = RECORD_MODULES[table];
  if (module === undefined) throw new HttpError(400, `table not allowed: ${table}`);
  const user = module === null ? await requireAdmin(req) : await requireCan(req, module, rs === RS.DELETED ? "del" : "edit");
  await setRecordStatus(table, id, rs, user.userId);
  return NextResponse.json({ ok: true, status: rs });
});
