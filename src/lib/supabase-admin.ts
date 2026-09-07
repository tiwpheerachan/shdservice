import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * SERVER-ONLY Supabase client using the SECRET key. It bypasses RLS, so it must
 * never be imported into any client component or bundled for the browser — use it
 * only inside route handlers / server code. The key comes from SUPABASE_SECRET_KEY
 * (no NEXT_PUBLIC_ prefix), so it is never sent to the browser.
 */
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not configured on the server");
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
