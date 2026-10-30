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
import { unpack } from '@/lib/obscure';

export type AccessValue = {
  /** the signed-in user's uuid (app_user.id, ADR 0008) — '' outside the provider */
  userId: string;
  name: string;
  email: string;
  role: string;
  isAdmin: boolean;
  grants: GrantMap;
  /** the บทสอน already offered (drizzle/0039): page paths answered, never ask again */
  tour?: { seen: string[]; off: boolean };
  /** video attachments can be stored (Cloudflare R2 configured — src/server/storage.ts r2Ready) */
  videos?: boolean;
};

const Ctx = React.createContext<AccessValue>({
  userId: '',
  name: '',
  email: '',
  role: '',
  isAdmin: false,
  grants: {},
});

/** `value.email` arrives packed from the server layout (no e-mail address in the HTML — src/lib/obscure.ts) */
export function AccessProvider({ value, children }: { value: AccessValue; children: React.ReactNode }) {
  const v = React.useMemo(() => ({ ...value, email: value.email ? unpack(value.email) : '' }), [value]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

/**
 * Client-side view of the signed-in user's permissions (from role_permission).
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
      /** where a job (its uuid) opens: บันทึกงานซ่อม, or — for a role that cannot open that page — the
       *  read-only receipt in a new tab (the print view only needs view on a job screen) */
      jobLink: (id: string) =>
        canViewPath(v.isAdmin, v.grants, '/jobs/repair')
          ? { href: `/jobs/repair?id=${encodeURIComponent(id)}` }
          : { href: `/print/job/${encodeURIComponent(id)}?auto=0`, target: '_blank' },
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
