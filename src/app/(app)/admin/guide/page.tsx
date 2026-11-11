import { PageHeader } from '@/components/shared/page-header';
import { Guide } from '@/components/guide/guide';

export const metadata = { title: 'คู่มือการใช้งาน' };

/** open to every approved user (EVERYONE_PATHS in lib/modules.ts), though listed under ข้อมูลระบบ */
export default function Page() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="คู่มือการใช้งาน"
        description="วิธีใช้ทุกหน้าจอของ OneService ตั้งแต่เข้าสู่ระบบจนถึงปิดงาน — เลือกหัวข้อทางซ้าย หรือกด ? ที่มุมขวาบนได้จากทุกหน้า"
      />
      <Guide />
    </div>
  );
}
