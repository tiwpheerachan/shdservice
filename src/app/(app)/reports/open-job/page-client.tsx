'use client';

import { CHANNELS } from '@/data/options';
import { int } from '@/lib/utils';
import { JobReport } from '../job-report';
import { DATES, START } from './filters';

export default function Page() {
  return (
    <JobReport
      report="open_job"
      title="รายงานการเปิดงานซ่อม"
      description="งานที่เปิดในระบบตามช่วงเวลาที่กำหนด — คอลัมน์และเงื่อนไขตามรายงานเดิม"
      start={START()}
      dates={DATES}
      extra={[{ kind: 'select', key: 'channel', label: 'ช่องทางการขาย', options: ['ทั้งหมด', ...CHANNELS] }]}
      file="report-open-job"
      kpis={(S, f) => {
        const days = Math.max(1, Math.round((Date.parse(f.to ?? '') - Date.parse(f.from ?? '')) / 86400000) + 1);
        return [
          { label: 'งานที่เปิดทั้งหมด', value: int(S?.total ?? 0), tone: 'primary' },
          { label: 'งานใหม่ (ยังไม่เริ่ม)', value: int(S?.fresh ?? 0), tone: 'warning' },
          { label: 'เฉลี่ยต่อวัน', value: ((S?.total ?? 0) / (days || 1)).toFixed(1) },
          { label: 'ช่องทางการขายหลัก', value: S?.topChannel ?? '—' },
        ];
      }}
    />
  );
}
