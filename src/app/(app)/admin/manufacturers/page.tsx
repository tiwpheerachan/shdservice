import { MasterTable } from '@/components/shared/master-table';
import { MASTER_NAME_LABEL } from '@/lib/validation/admin';
import { getManufacturers } from '@/data/queries';

export const metadata = { title: 'ยี่ห้อสินค้า' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const rows = await getManufacturers();
  return (
    <MasterTable
      config={{
        kind: 'manufacturers',
        title: 'ยี่ห้อสินค้า',
        description: 'รายชื่อผู้ผลิต / แบรนด์สินค้าที่ให้บริการซ่อม',
        nameLabel: MASTER_NAME_LABEL.manufacturers,
        rows,
      }}
    />
  );
}
