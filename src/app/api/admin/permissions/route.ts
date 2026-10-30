import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseQuery, requireAdmin, HttpError } from '@/server/auth';
import { permissionsDelete, permissionsSave } from '@/server/contract/admin';
import { deleteRole, listModules, listPermissions, listRoles, savePermissions } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Permission matrix (role_permission) + the role and module lists. Admin only. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  const [rows, roles, modules] = await Promise.all([listPermissions(), listRoles(), listModules()]);
  return NextResponse.json({ rows, roles, modules });
});

/** Upsert role_permission rows by (user_type, module_name). Admin only. */
export const POST = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  // role / menu trimmed, the flags true or "true" (permissionsSave); not a list → 400 "no items"; an unknown menu → 400
  const items = (await parseBody(req, permissionsSave)).items.filter((r) => r.role && r.menu);
  if (items.length === 0) throw new HttpError(400, 'no items');
  const saved = await savePermissions(items, me.pk);
  return NextResponse.json({ ok: true, saved });
});

/** ลบตำแหน่ง: the role's role_permission rows. Admin only; 409 while someone holds the role. */
export const DELETE = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const { role } = parseQuery(req, permissionsDelete);
  return NextResponse.json({ ok: true, deleted: await deleteRole(role, me.pk) });
});
