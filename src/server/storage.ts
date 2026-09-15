import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * File storage for attachments (job documents, payment slips). Files go to the
 * Supabase Storage bucket `attachments` (private) using the server-only secret
 * key; the DB rows (document_attach.system_file_name etc.) keep the object path.
 * Legacy files from the old Windows server were never migrated — those rows
 * only show their file name.
 */
export const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "attachments";

let client: SupabaseClient | null = null;
function storage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase Storage is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY)");
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client.storage;
}

export function systemFileName(original: string): string {
  const ext = (original.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "").toLowerCase();
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}${Math.random().toString(36).slice(2, 6)}${ext}`;
}

export async function uploadFile(path: string, file: File | Blob, contentType?: string): Promise<void> {
  const s = storage();
  // create the bucket on first use (no-op if it exists)
  await s.createBucket(BUCKET, { public: false }).catch(() => undefined);
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await s.from(BUCKET).upload(path, buf, { contentType: contentType || (file as File).type || "application/octet-stream", upsert: true });
  if (error) throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ (Supabase Storage: ${error.message}) — ตรวจสอบ SUPABASE_SECRET_KEY / bucket "${BUCKET}"`);
}

export async function signedUrl(path: string, seconds = 600): Promise<string | null> {
  const { data, error } = await storage().from(BUCKET).createSignedUrl(path, seconds);
  if (error) return null;
  return data.signedUrl;
}

export async function removeFile(path: string): Promise<void> {
  await storage().from(BUCKET).remove([path]).catch(() => undefined);
}
