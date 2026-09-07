import Link from "next/link";
import {
  FilePlus2,
  Wrench,
  PackageCheck,
  FileText,
  ShoppingCart,
  PackageMinus,
  Boxes,
  ArrowRight,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";

export const metadata = { title: "รายงาน" };

const REPORTS = [
  {
    href: "/reports/open-job",
    icon: FilePlus2,
    title: "รายงานการเปิดงานซ่อม",
    desc: "สรุปจำนวนงานที่เปิดใหม่ แยกตามช่วงเวลา ประเภทงาน และช่องทางรับเข้า",
  },
  {
    href: "/reports/repair-job",
    icon: Wrench,
    title: "รายงานการซ่อม",
    desc: "ผลการซ่อม อาการเสีย อะไหล่ที่ใช้ และช่างผู้รับผิดชอบ",
  },
  {
    href: "/reports/close-job",
    icon: PackageCheck,
    title: "รายงานการปิดงานซ่อม",
    desc: "งานที่ปิดแล้ว วิธีการส่งคืน และระยะเวลาดำเนินงาน (TAT)",
  },
  {
    href: "/reports/quotation",
    icon: FileText,
    title: "รายงานการเสนอราคา",
    desc: "ใบเสนอราคาทั้งหมด อัตราการอนุมัติ และมูลค่ารวม",
  },
  {
    href: "/reports/sale-order",
    icon: ShoppingCart,
    title: "รายงานการขาย",
    desc: "ยอดขายตามใบสั่งขาย แยกตามพนักงานขายและช่วงเวลา",
  },
  {
    href: "/reports/product-used",
    icon: PackageMinus,
    title: "รายงานการเบิกจ่ายอะไหล่",
    desc: "อะไหล่ที่ถูกเบิกใช้ในงานซ่อมและใบสั่งขาย",
  },
  {
    href: "/reports/product-onhand",
    icon: Boxes,
    title: "รายงานอะไหล่คงเหลือ",
    desc: "ยอดคงเหลือปัจจุบัน มูลค่าสต๊อก และรายการที่ต่ำกว่าจุดสั่งซื้อ",
  },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="รายงาน"
        description="เลือกรายงานที่ต้องการออก พร้อมกำหนดเงื่อนไขและส่งออกเป็น Excel / PDF"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="surface group flex gap-3 p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
              <r.icon className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                {r.title}
                <ArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
