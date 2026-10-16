// Permission modules — the values of app_config.module_name in the legacy DB —
// and which app routes each one guards. Shared by server (API enforcement) and
// client (sidebar / button visibility). Admin screens have no legacy module:
// they are System Admin only. Special rights (RIGHTS) are app_config rows too.

export type Action = 'add' | 'edit' | 'del' | 'view';

export type Module =
  | 'Job Management'
  | 'Job Assign'
  | 'Job Repair'
  | 'Job Closing'
  | 'Product'
  | 'Product Onhand'
  | 'Product Receive Stock'
  | 'Product Pick Stock'
  | 'Customer'
  | 'Quotation'
  | 'Sale Order'
  | Right;

/** The modules that have a page here — the permissions page lists these (the legacy DB also has
 *  Booking, Sale In, Sale Out, Warranty Extension, Job PickStock, Job ReturnStock: no page, rows left alone). */
export const PAGE_MODULES: readonly Module[] = [
  'Job Management',
  'Job Assign',
  'Job Repair',
  'Job Closing',
  'Product',
  'Product Onhand',
  'Product Receive Stock',
  'Product Pick Stock',
  'Customer',
  'Quotation',
  'Sale Order',
];

/**
 * Special rights: an app_config row under a pseudo module name, can_view = "has the right" (set on the
 * permissions page, section สิทธิ์พิเศษ). Every rule that used to name a role in code reads one of these.
 * System Admin holds all of them implicitly, except Job Take (checkRight).
 */
export const RIGHTS = {
  'SO Approve': 'อนุมัติ / ปฏิเสธ / ส่งกลับใบสั่งขาย',
  'Job Take': 'รับงานซ่อมและมีชื่อในช่องมอบหมายงาน',
  'Overdue All': 'ผู้รับงานซ่อม: กระดิ่งงานเกินกำหนดแสดงงานของทุกคน (ไม่ติ๊ก = เฉพาะงานของตัวเอง)',
  'Job Reopen': 'เปิดงานที่ปิดแล้วกลับมาแก้',
  'Job Money After Close': 'แก้ช่องเงินหลังปิดงาน',
  'Product Cost': 'เห็นราคาทุน',
  Report: 'เปิดหน้ารายงาน',
  Export: 'ส่งออก Excel',
} as const;
export type Right = keyof typeof RIGHTS;

/** Route prefix → module. First match wins (most specific first). */
const ROUTE_MODULES: [string, Module][] = [
  ['/jobs/assign', 'Job Assign'],
  ['/jobs/repair', 'Job Repair'],
  ['/jobs/outsource', 'Job Repair'],
  ['/jobs/close', 'Job Closing'],
  ['/jobs', 'Job Management'],
  ['/stock/products', 'Product'],
  ['/stock/inventory', 'Product Onhand'],
  ['/stock/receive', 'Product Receive Stock'],
  ['/stock/pick', 'Product Pick Stock'],
  ['/customers', 'Customer'],
  ['/quotation', 'Quotation'],
  ['/sale', 'Sale Order'],
  ['/reports', 'Report'],
];

/** Routes that only System Admin may use (no legacy module covers them). */
export const ADMIN_ONLY_PREFIXES = ['/admin'];
/** Exceptions inside the admin-only prefixes that every approved user may open. */
export const EVERYONE_PATHS = ['/admin/guide'];

export const ADMIN_USER_TYPE = 'System Admin';

export function moduleForPath(pathname: string): Module | null {
  const hit = ROUTE_MODULES.find(([p]) => pathname === p || pathname.startsWith(p + '/'));
  return hit ? hit[1] : null;
}

export function isAdminOnlyPath(pathname: string): boolean {
  if (EVERYONE_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) return false;
  return ADMIN_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export type Grant = { add: boolean; edit: boolean; del: boolean; view: boolean };
export type GrantMap = Partial<Record<string, Grant>>;

export const NO_GRANT: Grant = { add: false, edit: false, del: false, view: false };
export const FULL_GRANT: Grant = { add: true, edit: true, del: true, view: true };

/** Pure check used on both sides. `grants` is keyed by module name. */
export function checkGrant(isAdmin: boolean, grants: GrantMap, module: Module | null, action: Action): boolean {
  if (isAdmin) return true;
  if (!module) return false;
  return !!grants[module]?.[action];
}

/** Does the role hold a special right? Job Take says who IS a technician (assignee list, self-take), not
 *  what one may do — System Admin holds it only when ticked, as no admin was ever offered as an assignee. */
export function checkRight(isAdmin: boolean, grants: GrantMap, right: Right): boolean {
  return right === 'Job Take' ? !!grants[right]?.view : checkGrant(isAdmin, grants, right, 'view');
}

/** The grant a page needs beyond `view`: a create page (…/new — เปิดงานใหม่, สร้างใบเสนอราคา,
 *  สร้างใบสั่งขาย) exists only to insert, so it needs the module's `add`. */
export function pageAction(pathname: string): Action {
  return /\/new(\/|$)/.test(pathname) ? 'add' : 'view';
}

/** May this user open `pathname` at all? */
export function canViewPath(isAdmin: boolean, grants: GrantMap, pathname: string): boolean {
  if (isAdmin) return true;
  if (isAdminOnlyPath(pathname)) return false;
  const m = moduleForPath(pathname);
  // routes without a module (e.g. "/") are open to every approved user
  if (!m) return true;
  const need = pageAction(pathname);
  return checkGrant(false, grants, m, 'view') && (need === 'view' || checkGrant(false, grants, m, need));
}
