import type { ReportValues } from '@/components/shared/report-view';
import { daysAgo, today } from '@/lib/dates';
import { jobReportQuery } from '../report-specs';

/** pure: shared by the page and its server render */
export const START = (): ReportValues => ({ from: daysAgo(30), to: today() });
/** วันที่ค้นหา: label → dateBy (the first is the default) */
export const DATES = {
  วันที่เปิดงาน: 'create',
  วันที่รับเครื่อง: 'reception',
  วันที่ส่งต่อ: 'forward',
  วันที่ปิดงาน: 'closed',
};
/** the opening query as the KPI and table hooks send it (the server render's keys) */
export const startQuery = () => ({ ...jobReportQuery({ ...START(), dateBy: 'create' }), channel: '' });
