import { existsSync } from 'node:fs';

// A file named .env is loaded by Next.js into dev / build / start — production's values belong in .env.prod.local
// (AGENTS.md). Render has no such file; on a laptop this says so before a variable silently comes from it.
if (existsSync('.env') && process.env.NODE_ENV !== 'production' && !process.env.RENDER)
  console.warn('⚠ .env exists — Next.js loads it into npm run dev. Rename it to .env.prod.local (AGENTS.md).');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Cloudflare compresses at the edge (zstd / brotli / gzip, whatever the browser takes — docs/cloudflare-cdn.md);
  // gzip from here would be passed through as gzip. Every request comes through Cloudflare (origin auth).
  compress: false,
  // nothing uses next/image — keep /_next/image (and its SSRF/cache advisories) switched off
  images: { unoptimized: true },
  // the proxy buffers request bodies and SILENTLY truncates past this (default 10mb) —
  // uploads are allowed up to 10 MB + multipart overhead, so a 9.9 MB file arrived cut off
  experimental: { proxyClientMaxBodySize: '12mb' },
  // NEXT_DIST_DIR lets a production build/start run side by side with `next dev`
  // (both default to .next and corrupt each other). e.g. NEXT_DIST_DIR=.next-prod
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Baseline security headers — no framing (clickjacking), no MIME sniffing,
  // referrer trimmed, HSTS. Added after the Google Web Risk flag (2026-09-18).
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      // pages: a nonce CSP per request, set by src/proxy.ts (/api-docs sets its own)
      {
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }],
      },
      // public tracking: the URL carries the link token → never send it anywhere as a
      // Referer, never cache (a later rule wins over the global one for the same key).
      // CSP with a per-request nonce is set by src/proxy.ts.
      ...['/track', '/track/:path*', '/api/track/:path*'].map((source) => ({
        source,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      })),
      // public/ images (logos, login hero) — Next serves them with max-age=0, so every page
      // re-validated them. Names are NOT content-hashed → not immutable: 1 day fresh, then a
      // week of stale-while-revalidate so a replaced logo shows up within a day. Top-level only.
      // The same for /manifest.webmanifest (the same bytes for everyone, no login — src/proxy.ts).
      {
        source: '/:file([^/]+\\.(?:png|jpe?g|svg|ico|webp|webmanifest))',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
      },
    ];
  },
};
export default nextConfig;
