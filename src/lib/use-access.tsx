'use client';

import * as React from 'react';
import {
  checkGrant,
  checkRight,
  canViewPath,
  moduleForPath,
  type Action,
  type GrantMap,
  type Module,
  type Right,
} from '@/lib/modules';

export type AccessValue = {
  userId: number;
  name: string;
  email: string;
  role: string;
  isAdmin: boolean;
  grants: GrantMap;
};

const Ctx = React.createContext<AccessValue>({
  userId: 0,
  name: '',
  email: '',
  role: '',
  isAdmin: false,
  grants: {},
});

export function AccessProvider({ value, children }: { value: AccessValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Client-side view of the signed-in user's permissions (from app_config).
 * `can(module, action)` / `canPath(pathname)` mirror the server checks; use them
 * to hide menus and buttons. The API enforces the same rules on every write.
 */
export function useAccess() {
  const v = React.useContext(Ctx);
  return React.useMemo(
    () => ({
      ...v,
      can: (module: Module | null, action: Action) => checkGrant(v.isAdmin, v.grants, module, action),
      /** a special right (สิทธิ์พิเศษ: SO Approve, Job Take, …) — the API checks the same */
      has: (right: Right) => checkRight(v.isAdmin, v.grants, right),
      canPath: (pathname: string) => canViewPath(v.isAdmin, v.grants, pathname),
      /** a menu link: the page's `view`, plus the action it exists for (เปิดงานใหม่ = add, แก้ไข… = edit) */
      canLink: (l: { href: string; need?: Action }) =>
        canViewPath(v.isAdmin, v.grants, l.href) &&
        (!l.need || checkGrant(v.isAdmin, v.grants, moduleForPath(l.href), l.need)),
      /** where a job number opens: บันทึกงานซ่อม, or — for a role that cannot open that page — the
       *  read-only receipt in a new tab (the print view only needs view on a job screen) */
      jobLink: (no: string) =>
        canViewPath(v.isAdmin, v.grants, '/jobs/repair')
          ? { href: `/jobs/repair?job=${encodeURIComponent(no)}` }
          : { href: `/print/job/${encodeURIComponent(no)}?auto=0`, target: '_blank' },
      /** grants for the page the user is on, by pathname */
      forPath: (pathname: string) => {
        const m = moduleForPath(pathname);
        return {
          module: m,
          add: checkGrant(v.isAdmin, v.grants, m, 'add'),
          edit: checkGrant(v.isAdmin, v.grants, m, 'edit'),
          del: checkGrant(v.isAdmin, v.grants, m, 'del'),
          view: canViewPath(v.isAdmin, v.grants, pathname),
        };
      },
    }),
    [v],
  );
}
