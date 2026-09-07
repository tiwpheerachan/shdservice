import { MasterTable } from "@/components/shared/master-table";
import { getSymptoms } from "@/data/queries";

export const metadata = { title: "อาการเสีย มาตรฐาน" };
export const dynamic = "force-dynamic";

const GROUPS = [
  "ระบบไฟฟ้า",
  "มอเตอร์",
  "อุปกรณ์ควบคุม",
  "จอแสดงผล",
  "ระบบเชื่อมต่อ",
  "ประสิทธิภาพ",
  "โครงสร้าง",
];

export default async function Page() {
  const rows = await getSymptoms();
  return (
    <MasterTable
      config={{
        title: "อาการเสีย มาตรฐาน",
        description: "รายการอาการเสียมาตรฐานสำหรับเลือกตอนเปิดงานและบันทึกงานซ่อม",
        nameLabel: "อาการเสีย",
        detailLabel: "รายละเอียด",
        extraLabel: "กลุ่มอาการเสีย",
        extraOptions: GROUPS,
        rows,
      }}
    />
  );
}
