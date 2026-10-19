import { addDays, today } from '@/lib/dates';
import { QUOTATION_VALIDITY } from '@/lib/company';
import { fmtDate } from '@/server/mappers/format';

/** "7 Days" → 7: the validity printed on the quotation */
const QUOTE_VALID_DAYS = parseInt(QUOTATION_VALIDITY, 10) || 7;

/** a sent quotation the customer can no longer answer: พ้นกำหนด (8), or sent (2) and past its validity / the job says
 *  so (job_status 16 = JS.QUOTE_EXPIRED). Shared by /track, the print and the quotation list. */
export const quoteExpired = (st: number | null | undefined, at: string | null, jobStatusId: number | null) =>
  st === 8 || (st === 2 && (fmtDate(at) < addDays(today(), -QUOTE_VALID_DAYS) || jobStatusId === 16));
