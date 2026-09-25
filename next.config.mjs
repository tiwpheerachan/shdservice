/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
      // public tracking: the URL carries the link token → never send it anywhere as a
      // Referer, never cache (a later rule wins over the global one for the same key).
      // CSP with a per-request nonce is set by the middleware.
      ...["/track", "/track/:path*", "/api/track/:path*"].map((source) => ({
        source,
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      })),
    ];
  },
};
export default nextConfig;
