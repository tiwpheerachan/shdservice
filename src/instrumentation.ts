/**
 * Runs once when a server instance starts, and on every server error Next.js catches.
 * Reference: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
 */
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  // called in every runtime; only the Node one checks, or the edge copy repeats it
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { checkEnv } = await import("@/server/env");
  checkEnv();
}

/**
 * Errors Next.js catches outside our route `handle()` wrapper — server components,
 * layouts, the proxy. The digest is what error.tsx shows the user as the reference.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logError, safePath } = await import("@/lib/log");
  const h = request.headers;
  const one = (k: string) => (Array.isArray(h[k]) ? h[k][0] : h[k]) as string | undefined;
  logError(err, "request error", {
    digest: typeof err === "object" && err && "digest" in err ? String(err.digest) : undefined,
    reqId: one("cf-ray") ?? one("rndr-id"),
    method: request.method,
    path: safePath(request.path), // never the query string or a /track bearer token
    route: context.routePath,
    type: context.routeType,
  });
};
