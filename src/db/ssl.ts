/**
 * TLS options for DATABASE_URL (src/db/client.ts + scripts/migrate.ts — keep them identical).
 *
 * Supabase pooler: always encrypted. With DB_SSL_CA (PEM text; literal "\n" escapes accepted for
 * one-line env fields) the server certificate is VERIFIED against it — Supabase signs the pooler
 * with its own "Supabase Root 2021 CA" (not in Node's default store), see .env.example.
 * Without it: encrypted but unverified, as before, so a deploy without the variable keeps working.
 * Local docker: no TLS.
 */
export function dbSsl(url: string) {
  if (!/supabase\.co|supabase\.com|pooler/.test(url)) return undefined;
  const ca = (process.env.DB_SSL_CA ?? "").replace(/\\n/g, "\n").trim();
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}
