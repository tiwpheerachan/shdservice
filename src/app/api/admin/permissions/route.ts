import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireAdmin, HttpError } from '@/server/auth';
import { permissionsSave } from '@/server/contract/admin';
import { listModules, listPermissions, listRoles, savePermissions } from '@/server/services/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Permission matrix (app_config) + the role and module lists. Admin only. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  const [rows, roles, modules] = await Promise.all([listPermissions(), listRoles(), listModules()]);
  return NextResponse.json({ rows, roles, modules });
});

/** Upsert app_config rows by (user_type, module_name). Admin only. */
export const POST = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  // role / menu trimmed, the flags true or "true" (permissionsSave); not a list → 400 "no items"
  const items = (await parseBody(req, permissionsSave)).items.filter((r) => r.role && r.menu);
  if (items.length === 0) throw new HttpError(400, 'no items');
  const saved = await savePermissions(items, me.userId);
  return NextResponse.json({ ok: true, saved });
});
