import { PageHeader } from "@/components/shared/page-header";
import { Guide } from "@/components/guide/guide";

export const metadata = { title: "คู่มือการใช้งาน" };

/**
 * คู่มือการใช้งานสำหรับผู้ใช้ทุกคน — อยู่ในกลุ่ม ข้อมูลระบบ แต่เปิดให้ทุกคนที่
 * อนุมัติแล้ว (EVERYONE_PATHS ใน lib/modules.ts) และมีปุ่ม ? บน topbar
 * เนื้อหาอยู่ใน components/guide/content.tsx
 */
export default function Page() {
  return (
    <div className="space-y-5">
      <PageHeader title="คู่มือการใช้งาน" description="วิธีใช้ทุกหน้าจอของ OneService ตั้งแต่เข้าสู่ระบบจนถึงปิดงาน — เลือกหัวข้อทางซ้าย หรือกด ? ที่มุมขวาบนได้จากทุกหน้า" />
      <Guide />
    </div>
  );
}
