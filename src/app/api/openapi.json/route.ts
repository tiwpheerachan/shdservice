import { NextResponse, type NextRequest } from 'next/server';
import { handle, requireUser } from '@/server/auth';
import { openapi } from '@/server/contract/openapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The OpenAPI document generated from src/server/contract — for anyone who may use the app. */
export const GET = handle(async (req: NextRequest) => {
  await requireUser(req);
  return NextResponse.json(openapi);
});
