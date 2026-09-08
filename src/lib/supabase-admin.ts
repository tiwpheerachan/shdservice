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

/** Find an existing user's row id by email (case-insensitive), or null. */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  if (!email) return null;
  const db = supabaseAdmin();
  const { data } = await db
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/**
 * Upsert a user row. If the DB doesn't yet have the optional `avatar` / `title`
 * columns (migration not run), it retries without them so the core write still
 * succeeds. Returns an error message string, or null on success.
 */
export async function upsertUserRow(
  row: Record<string, unknown>
): Promise<string | null> {
  const db = supabaseAdmin();
  const { error } = await db.from("users").upsert(row, { onConflict: "id" });
  if (!error) return null;

  const missingColumn = /column|schema cache|does not exist/i.test(error.message);
  if (missingColumn && ("avatar" in row || "title" in row)) {
    const rest = { ...row };
    delete rest.avatar;
    delete rest.title;
    const retry = await db.from("users").upsert(rest, { onConflict: "id" });
    return retry.error ? retry.error.message : null;
  }
  return error.message;
}
