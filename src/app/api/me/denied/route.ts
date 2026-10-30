import { NextResponse, type NextRequest } from 'next/server';
import { canViewPath, isAdminOnlyPath, moduleForPath, pageAction } from '@/lib/modules';
import { grantsForUserType, handle, parseBody, requireUser } from '@/server/auth';
import { mePageDenied } from '@/server/contract/audit';
import { rateLimit } from '@/server/rate-limit';
import { guardDenied } from '@/server/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** AccessGuard (src/components/layout/access-guard.tsx) turned this user away from a page: DENIED, if the server's
 *  own grants agree — a page the role may open (stale client grants, a forged call) logs nothing. */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser(req);
  await rateLimit(req, 'page-denied', 30);
  const { path } = await parseBody(req, mePageDenied);
  if (!canViewPath(user.isAdmin, await grantsForUserType(user.userType), path)) {
    const m = moduleForPath(path);
    // 'page …': the page, not an API call (its own throttle key)
    const permission = `page ${isAdminOnlyPath(path) ? 'System Admin' : m ? `${m}:${pageAction(path)}` : path}`;
    guardDenied(user, permission, `ไม่มีสิทธิ์เข้าหน้า ${path}`, 'page');
  }
  return NextResponse.json({ ok: true });
});
