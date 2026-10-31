'use client';

import * as React from 'react';
import { useSymptomStats } from '@/data/db';
import { baht, int } from '@/lib/utils';
import { daysAgo, today } from '@/lib/dates';
import { JobReport } from '../job-report';

export default function Page() {
  // the active symptoms (the smaller by-usage list), read when the field is first focused — not with the page
  const [wanted, setWanted] = React.useState(false);
  const { data: SYMPTOMS, ...symptomsLookup } = useSymptomStats(wanted);
  return (
    <JobReport
      report="repair_job"
      title="รายงานการซ่อม"
      description="งานที่ซ่อมเสร็จตามช่วงวันที่ซ่อมเสร็จ — ผลการซ่อม อะไหล่ที่เปลี่ยน และช่างผู้รับผิดชอบ"
      start={{ from: daysAgo(30), to: today() }}
      dates={{ วันที่ซ่อมเสร็จ: 'repaired' }}
      extra={[
        {
          kind: 'select',
          key: 'symptom',
          label: 'อาการเสีย',
          options: ['ทั้งหมด', ...SYMPTOMS.map((s) => s.name)],
          lookup: symptomsLookup,
          onWant: () => setWanted(true),
        },
      ]}
      file="report-repair-job"
      kpis={(S) => {
        const count = S?.total ?? 0;
        const done = S?.done ?? 0;
        return [
          { label: 'งานที่ดำเนินการ', value: int(count), tone: 'primary' },
          { label: 'ซ่อมสำเร็จ', value: int(done), tone: 'success' },
          { label: 'มูลค่างานซ่อมรวม', value: baht(S?.amount ?? 0) },
          { label: 'อัตราซ่อมสำเร็จ', value: `${count ? ((done / count) * 100).toFixed(1) : '0'}%`, tone: 'success' },
        ];
      }}
    />
  );
}
