import { MasterTable } from "@/components/shared/master-table";
import { getManufacturers } from "@/data/queries";

export const metadata = { title: "ยี่ห้อสินค้า" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const rows = await getManufacturers();
  return (
    <MasterTable
      config={{
        title: "ยี่ห้อสินค้า",
        description: "รายชื่อผู้ผลิต / แบรนด์สินค้าที่ให้บริการซ่อม",
        nameLabel: "ชื่อยี่ห้อ",
        rows,
      }}
    />
  );
}
