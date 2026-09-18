/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NEXT_DIST_DIR lets a production build/start run side by side with `next dev`
  // (both default to .next and corrupt each other). e.g. NEXT_DIST_DIR=.next-prod
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
export default nextConfig;
