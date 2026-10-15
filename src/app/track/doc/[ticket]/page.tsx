import { headers } from 'next/headers';
import { FileX } from 'lucide-react';
import { clientIp, ipBucket } from '@/lib/client-ip';
import { TRACK_MSG } from '@/lib/track-public';
import { block, hit, hmac, isBlocked, logEvent } from '@/server/track-guard';
import { DOC_LINK_MINUTES, docForLink, findDoc } from '@/server/services/tracking';
import { JobReceiptDoc } from '@/components/print/docs/job-receipt';
import { QuotationDoc } from '@/components/print/docs/quotation';
import { ReturnNoteDoc } from '@/components/print/docs/return-note';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * /track/doc/<ticket> — one customer document, opened from the tracking page (POST /api/track/doc).
 *
 * The ticket is the only input: it names one document of one job and works for 10 minutes while
 * the tracking session / link that asked for it is live — from any browser, so LINE's in-app
 * browser → Safari still opens it (services/tracking.ts docForLink). The document is checked again
 * here (a quotation cancelled / a job deleted since → refused) and shown masked: no more than the
 * tracking page shows (`forCustomer`).
 * The proxy (src/proxy.ts) gives this path the /track headers (no-store, noindex, no-referrer, CSP).
 */
const FAIL_LIMIT = 5; // invalid tickets per IP per 10 minutes → blocked 15 minutes (as /api/track/data)
const DOC_EXPIRED = `ลิงก์เอกสารนี้หมดอายุแล้ว (ใช้ได้ ${DOC_LINK_MINUTES} นาที) กรุณากดเปิดเอกสารใหม่จากหน้าติดตามสถานะ`;

export default async function Page({ params }: { params: Promise<{ ticket: string }> }) {
  const { ticket } = await params;
  const h = await headers();
  const ip = clientIp(h);
  const ipKey = hmac(`ip:${ipBucket(ip)}`); // = trackCtx ipKey: the ticket: block is shared with /api/track/doc|data

  // the checks only decide WHAT to show; the JSX is built after the try (a render error inside a
  // document is not something this catch could handle anyway — it goes to the error boundary)
  let doc: Awaited<ReturnType<typeof findDoc>> = null;
  let refusal: string | null = null;
  try {
    const blockKey = `ticket:${ipKey}`;
    if (!(await hit('page_ip_min', ipKey, 30, 60)) || (await isBlocked(blockKey))) {
      logEvent('doc_rate_limited', { ipHash: ipKey, result: 'page' });
      refusal = TRACK_MSG.rateLimited;
    } else {
      const t = await docForLink(ticket);
      if (!t) {
        logEvent('doc_ticket_invalid', { ipHash: ipKey });
        if (!(await hit('ticket_fail', ipKey, FAIL_LIMIT, 10 * 60))) {
          await block(blockKey, 15);
          logEvent('ticket_block_triggered', { ipHash: ipKey, result: 'doc' });
        }
        refusal = DOC_EXPIRED;
      } else {
        doc = await findDoc(t.jobNo, t.kind, t.ref);
        if (!doc) refusal = DOC_EXPIRED;
        else logEvent('doc_opened', { ipHash: ipKey, jobNo: t.jobNo, result: doc.kind });
      }
    }
  } catch (e) {
    logError(e, 'track/doc');
    refusal = TRACK_MSG.docFail;
  }
  if (refusal || !doc) return <Refused text={refusal ?? DOC_EXPIRED} />;

  // the sheet the staff print, masked to what the tracking page itself shows (prices stay)
  if (doc.kind === 'quotation') return <QuotationDoc no={doc.ref} forCustomer />;
  if (doc.kind === 'return') return <ReturnNoteDoc no={doc.ref} forCustomer />;
  return <JobReceiptDoc no={doc.ref} forCustomer />;
}

function Refused({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-6 text-center text-sm text-neutral-600 shadow-sm">
      <FileX className="mx-auto mb-3 h-9 w-9 text-neutral-400" />
      {text}
    </div>
  );
}
