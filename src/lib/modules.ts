// Permission modules — the values of app_config.module_name in the legacy DB —
// and which app routes each one guards. Shared by server (API enforcement) and
// client (sidebar / button visibility). Admin & report screens have no legacy
// module: they are System Admin only.

export type Action = "add" | "edit" | "del" | "view";

export type Module =
  | "Job Management"
  | "Job Assign"
  | "Job Repair"
  | "Job Closing"
  | "Product"
  | "Product Onhand"
  | "Product Receive Stock"
  | "Product Pick Stock"
  | "Customer"
  | "Quotation"
  | "Sale Order";

/** Route prefix → module. First match wins (most specific first). */
const ROUTE_MODULES: [string, Module][] = [
  ["/jobs/assign", "Job Assign"],
  ["/jobs/repair", "Job Repair"],
  ["/jobs/outsource", "Job Repair"],
  ["/jobs/close", "Job Closing"],
  ["/jobs", "Job Management"],
  ["/stock/products", "Product"],
  ["/stock/inventory", "Product Onhand"],
  ["/stock/receive", "Product Receive Stock"],
  ["/stock/pick", "Product Pick Stock"],
  ["/customers", "Customer"],
  ["/quotation", "Quotation"],
  ["/sale", "Sale Order"],
];

/** Routes that only System Admin may use (no legacy module covers them). */
export const ADMIN_ONLY_PREFIXES = ["/admin", "/reports"];

export const ADMIN_USER_TYPE = "System Admin";

export function moduleForPath(pathname: string): Module | null {
  const hit = ROUTE_MODULES.find(([p]) => pathname === p || pathname.startsWith(p + "/"));
  return hit ? hit[1] : null;
}

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export type Grant = { add: boolean; edit: boolean; del: boolean; view: boolean };
export type GrantMap = Partial<Record<string, Grant>>;

export const NO_GRANT: Grant = { add: false, edit: false, del: false, view: false };
export const FULL_GRANT: Grant = { add: true, edit: true, del: true, view: true };

/** Pure check used on both sides. `grants` is keyed by module name. */
export function checkGrant(
  isAdmin: boolean,
  grants: GrantMap,
  module: Module | null,
  action: Action
): boolean {
  if (isAdmin) return true;
  if (!module) return false;
  return !!grants[module]?.[action];
}

/** May this user open `pathname` at all? */
export function canViewPath(isAdmin: boolean, grants: GrantMap, pathname: string): boolean {
  if (isAdmin) return true;
  if (isAdminOnlyPath(pathname)) return false;
  const m = moduleForPath(pathname);
  // routes without a module (e.g. "/") are open to every approved user
  return m ? checkGrant(false, grants, m, "view") : true;
}
