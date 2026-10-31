'use client';

import * as React from 'react';
import { useModels } from '@/data/db';
import type { ReportValues } from '@/components/shared/report-view';

/** only the chosen ยี่ห้อ's models (the whole list is ~140 KB), read when the รุ่น field is first focused — not with the page */
export function useBrandModels() {
  const [brand, setBrand] = React.useState('');
  const { data: MODELS, ...modelsLookup } = useModels('exclude', { brand, enabled: !!brand });
  const wantModels = (d: ReportValues) => {
    const b = d.brand && d.brand !== 'ทั้งหมด' ? d.brand : '';
    if (b) setBrand(b);
  };
  return { MODELS, modelsLookup, wantModels };
}
