import type { ReportValues } from '@/components/shared/report-view';
import { daysAgo, today } from '@/lib/dates';

/** the report's opening filters (last 30 days, Thai calendar) — pure, shared by the page and its server render */
export const START = (): ReportValues => ({ from: daysAgo(30), to: today(), type: '', channel: '' });
/** the filters as the KPI and table hooks send them */
export const queryOf = (f: ReportValues) => ({ from: f.from, to: f.to, type: f.type, channel: f.channel });
