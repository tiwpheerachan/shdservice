import { NextResponse, type NextRequest } from "next/server";
import { handle, requireAdmin, readJson, HttpError } from "@/server/auth";
import { listModules, listPermissions, listRoles, savePermissions } from "@/server/services/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const bool = (v: unknown) => v === true || v === "true";

/** Permission matrix (app_config) + the role and module lists. Admin only. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  const [rows, roles, modules] = await Promise.all([listPermissions(), listRoles(), listModules()]);
  return NextResponse.json({ rows, roles, modules });
});

/** Upsert app_config rows by (user_type, module_name). Admin only. */
export const POST = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const body = await readJson<{ items?: unknown }>(req);
  const items = Array.isArray(body.items)
    ? (body.items as Record<string, unknown>[])
        .map((r) => ({
          role: str(r.role),
          menu: str(r.menu),
          add: bool(r.add),
          edit: bool(r.edit),
          del: bool(r.del),
          view: bool(r.view),
        }))
        .filter((r) => r.role && r.menu)
    : [];
  if (items.length === 0) throw new HttpError(400, "no items");
  const saved = await savePermissions(items, me.userId);
  return NextResponse.json({ ok: true, saved });
});
