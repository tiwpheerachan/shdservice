import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * File storage — one PRIVATE Supabase Storage bucket `oneservice`, served only
 * through /api/files (signed URL, login required). Layout:
 *   jobs/{jobNo}/attachments/{file}   document_attach.system_file_name  (file name only, 50 chars)
 *   jobs/{jobNo}/slip/{file}          job.job_payment_slip_file_name    (full path)
 *   sale-orders/{soNo}/slip/{file}    sale_out_hd.slip_file_name        (full path)
 *   products/{code}/{file}            product.pictrue_file_name         (file name only, 50 chars)
 * Legacy files were copied into the same layout (2026-09-16): product images
 * 786/822 and job attachments from the old server's FileUpload folder; rows
 * whose file was missing on the old server just show their file name.
 */
export const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "oneservice";

export const filePath = {
  attachment: (jobNo: string, file: string) => `jobs/${jobNo}/attachments/${file}`,
  jobSlip: (jobNo: string, file: string) => `jobs/${jobNo}/slip/${file}`,
  saleOrderSlip: (soNo: string, file: string) => `sale-orders/${soNo}/slip/${file}`,
  productImage: (code: string, file: string) => `products/${code}/${file}`,
  profileLogo: (id: number, file: string) => `profiles/${id}/${file}`,
};

/** Accept either a stored full path or a bare file name (legacy / short columns). */
export function resolvePath(stored: string, fallback: (file: string) => string): string {
  return stored.includes("/") ? stored : fallback(stored);
}

export const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
