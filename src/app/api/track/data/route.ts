import type { NextRequest } from "next/server";
import { hit, isBlocked, block, consumeTicket, logEvent } from "@/server/track-guard";
import { trackJson, trackCtx, readSmallJson } from "@/server/track-http";
import { publicJobByNo } from "@/server/services/tracking";
import { TRACK_MSG } from "@/lib/track-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/track/data { ticket } → PublicJob
 *
 * The ticket is the ONLY input: any job_no / jobId / linkToken in the body is
 * ignored — the job is whatever the server bound to the ticket. The ticket is
 * consumed atomically (one DELETE … RETURNING), so it works once, for 3 minutes,
 * from the IP + browser it was issued to. Every failure reads the same.
 */
const FAIL_LIMIT = 5; // invalid tickets per IP …
const FAIL_WINDOW = 10 * 60; // … per 10 minutes → blocked 15 minutes

export async function POST(req: NextRequest) {
  const c = trackCtx(req);
  const ticketFail = () => trackJson({ ok: false, error: TRACK_MSG.ticketFail, retry: true }, 401);
  const limited = () => trackJson({ ok: false, error: TRACK_MSG.rateLimited }, 429, { "Retry-After": "60" });

  try {
    const blockKey = `ticket:${c.ipKey}`;
    if (!(await hit("data_ip_min", c.ipKey, 5, 60))) {
      logEvent("data_rate_limited", { ipHash: c.ipKey, result: "ip", requestId: c.requestId });
      return limited();
    }
    if (await isBlocked(blockKey)) {
      logEvent("data_rate_limited", { ipHash: c.ipKey, result: "blocked", requestId: c.requestId });
      return limited();
    }

    const body = await readSmallJson(req);
    const jobNo = await consumeTicket(body.ticket, c.ip, c.ua);
    if (!jobNo) {
      logEvent("ticket_invalid", { ipHash: c.ipKey, requestId: c.requestId });
      if (!(await hit("ticket_fail", c.ipKey, FAIL_LIMIT, FAIL_WINDOW))) {
        await block(blockKey, 15);
        logEvent("ticket_block_triggered", { ipHash: c.ipKey, requestId: c.requestId });
      }
      return ticketFail();
    }

    // the job may have been deleted / expired in the 3 minutes since the ticket was issued
    const job = await publicJobByNo(jobNo);
    if (!job) return ticketFail();
    logEvent("ticket_consumed", { ipHash: c.ipKey, jobNo, requestId: c.requestId });
    return trackJson({ ok: true, job });
  } catch (e) {
    console.error("[track/data]", e instanceof Error ? e.message : e);
    return ticketFail();
  }
}
