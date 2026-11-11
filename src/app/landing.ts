import {
  canViewPath,
  checkGrant,
  checkRight,
  moduleForPath,
  EVERYONE_PATHS,
  type Action,
  type GrantMap,
} from '@/lib/modules';
import { ALL_LINKS } from '@/lib/nav';

export const DASHBOARD = '/jobs/dashboard';

/**
 * Where "/" sends a signed-in, approved user: an approver (SO Approve) who may open the sale order list → the orders
 * waiting for approval (System Admin keeps the dashboard), else the dashboard, else the first menu page it may open,
 * else the guide — never a "ไม่มีสิทธิ์เข้าหน้า …" toast.
 */
export function landingPath(user: { isAdmin: boolean; userType: string | null }, grants: GrantMap): string {
  const may = (href: string, need?: Action) =>
    canViewPath(user.isAdmin, grants, href) && (!need || checkGrant(user.isAdmin, grants, moduleForPath(href), need));
  if (!user.isAdmin && checkRight(false, grants, 'SO Approve') && may('/sale/orders', 'edit'))
    return '/sale/orders?pending=1';
  if (may(DASHBOARD)) return DASHBOARD;
  const first = ALL_LINKS.find((l) => !EVERYONE_PATHS.includes(l.href) && may(l.href, l.need));
  return first?.href ?? '/admin/guide';
}
