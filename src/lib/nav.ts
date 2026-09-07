import type { LucideIcon } from "lucide-react";
import {
  Settings2,
  Boxes,
  Users,
  Wrench,
  FileText,
  ShoppingCart,
  BarChart3,
} from "lucide-react";

export type NavItem = { title: string; href: string; badge?: string };
export type NavGroup = {
  id: string;
  no: number;
  title: string;
  icon: LucideIcon;
  href: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    id: "admin",
    no: 1,
    title: "ข้อมูลระบบ",
    icon: Settings2,
    href: "/admin/users",
    items: [
      { title: "ผู้ใช้ระบบ", href: "/admin/users" },
      { title: "สิทธิการใช้งาน", href: "/admin/permissions" },
      { title: "หมวดหมู่สินค้า", href: "/admin/categories" },
      { title: "ยี่ห้อสินค้า", href: "/admin/manufacturers" },
      { title: "รุ่นสินค้า", href: "/admin/models" },
      { title: "สีสินค้า", href: "/admin/colors" },
      { title: "ประเภทงานซ่อม", href: "/admin/job-types" },
      { title: "ประเภทเครื่องซ่อม", href: "/admin/product-types" },
      { title: "อาการเสีย มาตรฐาน", href: "/admin/symptoms" },
    ],
  },
  {
    id: "stock",
    no: 2,
    title: "ข้อมูลอะไหล่",
    icon: Boxes,
    href: "/stock/products",
    items: [
      { title: "รายการอะไหล่ทั้งหมด", href: "/stock/products" },
      { title: "รับเข้าอะไหล่", href: "/stock/receive" },
      { title: "ตัดจ่ายอะไหล่", href: "/stock/pick" },
      { title: "ประวัติการเคลื่อนไหว", href: "/stock/inventory" },
    ],
  },
  {
    id: "customer",
    no: 3,
    title: "ข้อมูลลูกค้า",
    icon: Users,
    href: "/customers",
    items: [{ title: "รายชื่อลูกค้าทั้งหมด", href: "/customers" }],
  },
  {
    id: "jobs",
    no: 4,
    title: "ข้อมูลงานบริการ",
    icon: Wrench,
    href: "/jobs/dashboard",
    items: [
      { title: "Dashboard", href: "/jobs/dashboard" },
      { title: "รายการงานทั้งหมด", href: "/jobs/list" },
      { title: "เปิดงานใหม่", href: "/jobs/new" },
      { title: "แก้ไขข้อมูลงาน", href: "/jobs/edit" },
      { title: "จนท.รับมอบหมายงาน", href: "/jobs/assign" },
      { title: "บันทึกงานซ่อม", href: "/jobs/repair" },
      { title: "บันทึกงานส่งซ่อมต่อ", href: "/jobs/outsource" },
      { title: "บันทึกงาน Swap/Refund", href: "/jobs/swap-refund" },
      { title: "ปิดงาน-ส่งคืนสินค้า", href: "/jobs/close" },
    ],
  },
  {
    id: "quotation",
    no: 5,
    title: "ข้อมูลเสนอราคา",
    icon: FileText,
    href: "/quotation/list",
    items: [
      { title: "รายการใบเสนอราคา", href: "/quotation/list" },
      { title: "สร้างใบเสนอราคา", href: "/quotation/new" },
      { title: "แก้ไขใบเสนอราคา", href: "/quotation/edit" },
    ],
  },
  {
    id: "sale",
    no: 6,
    title: "ข้อมูลใบสั่งขาย",
    icon: ShoppingCart,
    href: "/sale/orders",
    items: [
      { title: "รายการใบสั่งขาย", href: "/sale/orders" },
      { title: "สร้างใบสั่งขาย", href: "/sale/orders/new" },
      { title: "แก้ไขใบสั่งขาย", href: "/sale/orders/edit" },
    ],
  },
  {
    id: "reports",
    no: 7,
    title: "รายงาน",
    icon: BarChart3,
    href: "/reports",
    items: [
      { title: "ภาพรวมรายงาน", href: "/reports" },
      { title: "รายงานการเปิดงานซ่อม", href: "/reports/open-job" },
      { title: "รายงานการซ่อม", href: "/reports/repair-job" },
      { title: "รายงานการปิดงานซ่อม", href: "/reports/close-job" },
      { title: "รายงานการเสนอราคา", href: "/reports/quotation" },
      { title: "รายงานการขาย", href: "/reports/sale-order" },
      { title: "รายงานการเบิกจ่ายอะไหล่", href: "/reports/product-used" },
      { title: "รายงานอะไหล่คงเหลือ", href: "/reports/product-onhand" },
    ],
  },
];

export const ALL_LINKS = NAV.flatMap((g) =>
  g.items.map((i) => ({ ...i, group: g.title, groupNo: g.no }))
);

export function findBreadcrumb(pathname: string) {
  for (const g of NAV) {
    for (const i of g.items) {
      if (i.href === pathname) return { group: g, item: i };
    }
  }
  const g = NAV.find((g) => pathname.startsWith("/" + g.id));
  return g ? { group: g, item: undefined } : undefined;
}
