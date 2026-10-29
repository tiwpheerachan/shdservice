import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan, HttpError } from '@/server/auth';
import { attachmentVideoUrl } from '@/server/contract/jobs';
import { rateLimit } from '@/server/rate-limit';
import { attachableJob } from '@/server/services/jobs';
import { MAX_VIDEO_BYTES, filePath, signedUploadUrl, videoFileName } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A video attachment goes from the browser straight to Cloudflare R2, never through this server (a 3-minute
 * clip is ~35–60 MB, up to ~115 MB): this hands out a presigned upload URL (2 h) for a path chosen here, after the checks of
 * POST /api/attachments. The browser then calls POST /api/attachments/video/confirm.
 */
export const POST = handle(async (req: NextRequest) => {
  await requireCan(req, 'Job Management', 'edit');
  await rateLimit(req, 'upload', 30);
  const { jobNo, type, size } = await parseBody(req, attachmentVideoUrl);
  // the size is signed into the URL: R2 takes exactly these bytes — never more than the cap
  if (size > MAX_VIDEO_BYTES) throw new HttpError(413, 'วิดีโอใหญ่เกิน 200MB');
  const no = await attachableJob(jobNo);
  const file = videoFileName(type); // its `v` keeps it (and its thumbnail) in R2 — storage.ts onR2
  // R2 not configured → 503 R2_MISSING
  return NextResponse.json({ file, url: await signedUploadUrl(filePath.attachment(no, file), type, size) });
});
