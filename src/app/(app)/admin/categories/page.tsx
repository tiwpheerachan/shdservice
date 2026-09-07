import { MasterTable } from "@/components/shared/master-table";
import { getCategories } from "@/data/queries";

export const metadata = { title: "หมวดหมู่สินค้า" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const rows = await getCategories();
  return (
    <MasterTable
      config={{
        title: "หมวดหมู่สินค้า",
        description: "จัดกลุ่มอะไหล่และสินค้าเพื่อใช้ในการค้นหาและออกรายงาน",
        nameLabel: "ชื่อหมวดหมู่",
        detailLabel: "รายละเอียด",
        rows,
      }}
    />
  );
}
