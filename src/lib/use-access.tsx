"use client";

import * as React from "react";
import {
  checkGrant,
  canViewPath,
  moduleForPath,
  type Action,
  type GrantMap,
  type Module,
} from "@/lib/modules";

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
  name: "",
  email: "",
  role: "",
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
      canPath: (pathname: string) => canViewPath(v.isAdmin, v.grants, pathname),
      /** grants for the page the user is on, by pathname */
      forPath: (pathname: string) => {
        const m = moduleForPath(pathname);
        return {
          module: m,
          add: checkGrant(v.isAdmin, v.grants, m, "add"),
          edit: checkGrant(v.isAdmin, v.grants, m, "edit"),
          del: checkGrant(v.isAdmin, v.grants, m, "del"),
          view: canViewPath(v.isAdmin, v.grants, pathname),
        };
      },
    }),
    [v]
  );
}
