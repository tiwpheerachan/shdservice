import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  // Fail loudly in dev; in prod the build will have these inlined.
  // eslint-disable-next-line no-console
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — check .env.local"
  );
}

// Read-only public app (no auth): don't persist sessions.
export const supabase = createClient(url ?? "", key ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});
