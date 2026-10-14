const PAGE_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // nothing uses next/image — keep /_next/image (and its SSRF/cache advisories) switched off
  images: { unoptimized: true },
  // the proxy buffers request bodies and SILENTLY truncates past this (default 10mb) —
  // uploads are allowed up to 10 MB + multipart overhead, so a 9.9 MB file arrived cut off
  experimental: { proxyClientMaxBodySize: "12mb" },
  // NEXT_DIST_DIR lets a production build/start run side by side with `next dev`
  // (both default to .next and corrupt each other). e.g. NEXT_DIST_DIR=.next-prod
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Baseline security headers — no framing (clickjacking), no MIME sniffing,
  // referrer trimmed, HSTS. Added after the Google Web Risk flag (2026-09-18).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      // staff app CSP (OneLink lib/security-headers.ts): no foreign scripts, no plugins, no
      // framing, forms only to us. Inline scripts stay allowed (theme script + Next's bootstrap
      // carry no nonce here); images may be https: (Lark avatars, Supabase signed URLs).
      // NOT on /track — a second CSP would intersect with its nonce policy and block Turnstile.
      {
        source: "/((?!api/|track).*)",
        headers: [{ key: "Content-Security-Policy", value: PAGE_CSP }],
      },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }] },
      // public tracking: the URL carries the link token → never send it anywhere as a
      // Referer, never cache (a later rule wins over the global one for the same key).
      // CSP with a per-request nonce is set by src/proxy.ts.
      ...["/track", "/track/:path*", "/api/track/:path*"].map((source) => ({
        source,
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      })),
      // public/ images (logos, login hero) — Next serves them with max-age=0, so every page
      // re-validated them. Names are NOT content-hashed → not immutable: 1 day fresh, then a
      // week of stale-while-revalidate so a replaced logo shows up within a day. Top-level only.
      {
        source: "/:file([^/]+\\.(?:png|jpe?g|svg|ico|webp))",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
};
export default nextConfig;
