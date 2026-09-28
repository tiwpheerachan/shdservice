import { headers } from "next/headers";
import { FileX } from "lucide-react";
import { clientIp } from "@/lib/client-ip";
import { TRACK_MSG } from "@/lib/track-public";
import { block, consumeDocTicket, hit, hmac, isBlocked, logEvent } from "@/server/track-guard";
import { findDoc } from "@/server/services/tracking";
import { JobReceiptDoc } from "@/components/print/docs/job-receipt";
import { QuotationDoc } from "@/components/print/docs/quotation";
import { ReturnNoteDoc } from "@/components/print/docs/return-note";

export const dynamic = "force-dynamic";

/**
 * /track/doc/<ticket> — one customer document, opened from the tracking page (POST /api/track/doc).
 *
 * The ticket is the only input: it names one document of one job, works once, for 60 seconds,
 * from the IP + browser it was issued to (drizzle/0019). The document is checked again here
 * (a quotation cancelled / a job deleted since the ticket was issued → refused).
 * Refresh = the ticket is spent → open the document again from the tracking page.
 * The middleware gives this path the /track headers (no-store, noindex, no-referrer, CSP).
 */
const FAIL_LIMIT = 5; // invalid tickets per IP per 10 minutes → blocked 15 minutes (as /api/track/data)

export default async function Page({ params }: { params: Promise<{ ticket: string }> }) {
  const { ticket } = await params;
  const h = await headers();
  const ip = clientIp(h);
  const ipKey = hmac(`ip:${ip}`);
  const ua = h.get("user-agent") ?? "";

  let doc: Awaited<ReturnType<typeof findDoc>> = null;
  try {
    const blockKey = `ticket:${ipKey}`;
    if (!(await hit("page_ip_min", ipKey, 30, 60)) || (await isBlocked(blockKey))) {
      logEvent("doc_rate_limited", { ipHash: ipKey, result: "page" });
      return <Refused text={TRACK_MSG.rateLimited} />;
    }
    const t = await consumeDocTicket(ticket, ip, ua);
    if (!t) {
      logEvent("doc_ticket_invalid", { ipHash: ipKey });
      if (!(await hit("ticket_fail", ipKey, FAIL_LIMIT, 10 * 60))) {
        await block(blockKey, 15);
        logEvent("ticket_block_triggered", { ipHash: ipKey, result: "doc" });
      }
      return <Refused text={TRACK_MSG.docExpired} />;
    }
    doc = await findDoc(t.jobNo, t.kind, t.ref);
    if (!doc) return <Refused text={TRACK_MSG.docExpired} />;
    logEvent("doc_opened", { ipHash: ipKey, jobNo: t.jobNo, result: doc.kind });
  } catch (e) {
    console.error("[track/doc]", e instanceof Error ? e.message.split("\n")[0] : e);
    return <Refused text={TRACK_MSG.docFail} />;
  }

  // the same sheet the staff print — what the customer's paper copy already shows
  if (doc.kind === "quotation") return <QuotationDoc no={doc.ref} />;
  if (doc.kind === "return") return <ReturnNoteDoc no={doc.ref} />;
  return <JobReceiptDoc no={doc.ref} />;
}

function Refused({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-6 text-center text-sm text-neutral-600 shadow-sm">
      <FileX className="mx-auto mb-3 h-9 w-9 text-neutral-400" />
      {text}
    </div>
  );
}
