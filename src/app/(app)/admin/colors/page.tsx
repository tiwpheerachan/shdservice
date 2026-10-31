import { MasterTable } from '@/components/shared/master-table';
import { MASTER_NAME_LABEL } from '@/lib/validation/admin';
import { getColors } from '@/data/queries';

export const metadata = { title: 'สีสินค้า' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const rows = await getColors();
  return (
    <MasterTable
      config={{
        kind: 'colors',
        title: 'สีสินค้า',
        description: 'รหัสสีมาตรฐานสำหรับระบุสีของเครื่องที่รับซ่อม',
        nameLabel: MASTER_NAME_LABEL.colors,
        detailLabel: 'รายละเอียด',
        rows,
      }}
    />
  );
}
