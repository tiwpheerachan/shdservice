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
 * The value is the right's one short name — the permissions page, the error messages and the hints all
 * say this (rightLabel); RIGHT_HINTS is the longer line under it on the permissions page.
 */
export const RIGHTS = {
  'SO Approve': 'อนุมัติใบสั่งขาย',
  'Job Take': 'รับงานซ่อม',
  'Overdue All': 'เห็นงานเกินกำหนดของทุกคน',
  'Job Reopen': 'เปิดงานที่ปิดแล้ว',
  'Job Money After Close': 'แก้ช่องเงินหลังปิดงาน',
  'Product Cost': 'เห็นราคาทุน',
  Report: 'เปิดหน้ารายงาน',
  Export: 'ส่งออก Excel',
} as const;
export const RIGHT_HINTS: Record<keyof typeof RIGHTS, string> = {
  'SO Approve': 'อนุมัติ / ปฏิเสธ / ส่งกลับแก้ไขใบสั่งขายที่รออนุมัติ',
  'Job Take': 'มีชื่อในช่อง มอบหมายงานนี้ให้ และรับงานเองตอนบันทึกงานซ่อม',
  'Overdue All': 'ผู้รับงานซ่อม: กระดิ่งงานเกินกำหนดแสดงงานของทุกคน (ไม่ติ๊ก = เฉพาะงานของตัวเอง)',
  'Job Reopen': 'เปลี่ยนงานที่ปิดแล้วกลับเป็นสถานะที่ยังไม่ปิด เพื่อแก้ต่อ',
  'Job Money After Close': 'แก้ค่าบริการ / ค่าอะไหล่ / การชำระเงินของงานที่ปิดแล้ว',
  'Product Cost': 'เห็นราคาทุนในข้อมูลสินค้า',
  Report: 'เปิดเมนูรายงาน',
  Export: 'ปุ่มส่งออก Excel ในรายการและรายงาน',
};
export type Right = keyof typeof RIGHTS;

/** how messages and hints name a right: สิทธิ์พิเศษ "อนุมัติใบสั่งขาย" (SO Approve) */
export const rightLabel = (r: Right) => `สิทธิ์พิเศษ "${RIGHTS[r]}" (${r})`;
/** the 403 of a user whose role lacks the right */
export const noRight = (r: Right) => `บทบาทของคุณไม่มี${rightLabel(r)}`;

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

/** System Admin holds every module grant and right without a ticked row — except Job Take: it says who IS a
 *  technician (assignee list, self-take), not what one may do, and no admin was ever offered as an assignee. */
export const adminImplicit = (m: Module) => m !== 'Job Take';

/** Does the role hold a special right? */
export function checkRight(isAdmin: boolean, grants: GrantMap, right: Right): boolean {
  return checkGrant(isAdmin && adminImplicit(right), grants, right, 'view');
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
