'use client';

import { RETURN_METHODS } from '@/data/options';
import { baht, int } from '@/lib/utils';
import { daysAgo, today } from '@/lib/dates';
import { JobReport } from '../job-report';

export default function Page() {
  return (
    <JobReport
      report="close_job"
      title="รายงานการปิดงานซ่อม"
      description="งานที่ปิดแล้วตามช่วงวันที่ปิดงาน — การชำระเงิน วิธีส่งคืน และระยะเวลาดำเนินงาน (TAT)"
      start={{ from: daysAgo(30), to: today() }}
      dates={{ วันที่ปิดงานซ่อม: 'closed' }}
      fixed={{ statusGroup: 'Finished' }}
      statusGroup="Finished"
      extra={[{ kind: 'select', key: 'returnType', label: 'วิธีการส่งคืน', options: ['ทั้งหมด', ...RETURN_METHODS] }]}
      file="report-close-job"
      kpis={(S) => [
        { label: 'งานที่ปิดแล้ว', value: int(S?.total ?? 0), tone: 'success' },
        { label: 'ยอดรับชำระรวม', value: baht(S?.paid ?? 0) },
        { label: 'TAT เฉลี่ย (วัน)', value: String(S?.avgTat ?? 0), sub: 'วันที่เปิดงาน → ส่งคืน / ปิดงาน' },
        { label: 'เกิน 30 วัน', value: int(S?.over30 ?? 0), tone: 'danger' },
      ]}
    />
  );
}
