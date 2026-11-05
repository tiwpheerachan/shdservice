import { addDays, today } from '@/lib/dates';
import { QUOTE_VALID_DAYS } from '@/lib/company';
import { JS, QS } from '@/lib/status-ids';
import { fmtDate } from '@/server/mappers/format';

/** a sent quotation the customer can no longer answer: พ้นกำหนด, or sent and past its validity / the job says
 *  so (JS.QUOTE_EXPIRED). Shared by /track, the print and the quotation list. */
export const quoteExpired = (st: number | null | undefined, at: string | null, jobStatusId: number | null) =>
  st === QS.EXPIRED ||
  (st === QS.SENT && (fmtDate(at) < addDays(today(), -QUOTE_VALID_DAYS) || jobStatusId === JS.QUOTE_EXPIRED));
