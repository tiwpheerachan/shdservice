/**
 * Legacy files → Supabase Storage bucket `oneservice`
 *
 * The old system kept only FILE NAMES in the database; the files lived in two
 * folders on the old web server. This tool matches those names against the
 * (current) database and uploads each file to the path the new app expects:
 *
 *   product.pictrue_file_name            ImagesProduct/  →  products/{product_code}/{file}
 *   document_attach.system_file_name     FileUpload/     →  jobs/{job_no}/attachments/{file}
 *   sale_out_hd.slip_file_name           FileUpload/     →  sale-orders/{so_no}/slip/{file}
 *   job.job_payment_slip_file_name       FileUpload/     →  jobs/{job_no}/slip/{file}
 *
 * Safe to re-run after every re-dump: files already in the bucket are skipped
 * (checked in ONE query against storage.objects), uploads are upsert.
 *
 * Lives in shdservice/scripts (needs the app's node_modules + .env); the wrapper
 * setupdata/upload_files.sh runs it from anywhere:
 *   cd shdservice
 *   ./setupdata/upload_files.sh validate
 *   ./setupdata/upload_files.sh upload [images|attachments|slips|all] [--images DIR] [--files DIR] [--dry] [--force]
 * Source folders default to setupdata/ImagesProduct and setupdata/FileUpload.
 *
 * Env (from shdservice/.env): DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_STORAGE_BUCKET (default oneservice)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

type Ref = { kind: "images" | "attachments" | "slips"; key: string; file: string; table: string };

const args = process.argv.slice(2);
const cmd = args[0] === "upload" ? "upload" : "validate";
const kindArg = args[1] && !args[1].startsWith("--") ? args[1] : "all";
const opt = (name: string, dflt: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
// default source folders: ../setupdata/{ImagesProduct,FileUpload} (next to the dump), else ~/Downloads/…
const SETUP = path.resolve(process.cwd(), "../setupdata");
const firstDir = (...cands: string[]) => cands.find((d) => fs.existsSync(d)) ?? cands[0];
const IMAGES_DIR = opt("--images", firstDir(path.join(SETUP, "ImagesProduct"), path.join(os.homedir(), "Downloads/ImagesProduct"))).replace(/^~/, os.homedir());
const FILES_DIR = opt("--files", firstDir(path.join(SETUP, "FileUpload"), path.join(os.homedir(), "Downloads/FileUpload"))).replace(/^~/, os.homedir());
const DRY = args.includes("--dry");
const FORCE = args.includes("--force"); // re-upload even if the object exists
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "oneservice";
const CONC = Number(process.env.CONC || 4);

const need = (k: string) => { if (!process.env[k]) { console.error(`missing env ${k} (run from shdservice/ so .env is loaded)`); process.exit(2); } };
need("DATABASE_URL"); need("NEXT_PUBLIC_SUPABASE_URL"); need("SUPABASE_SECRET_KEY");

const pathOf = (r: Ref) =>
  r.kind === "images" ? `products/${r.key}/${r.file}`
  : r.kind === "attachments" ? `jobs/${r.key}/attachments/${r.file}`
  : r.table === "job" ? `jobs/${r.key}/slip/${r.file}` : `sale-orders/${r.key}/slip/${r.file}`;
const srcDir = (r: Ref) => (r.kind === "images" ? IMAGES_DIR : FILES_DIR);
const ct = (f: string) => { const e = f.toLowerCase().split(".").pop(); return e === "png" ? "image/png" : e === "webp" ? "image/webp" : e === "gif" ? "image/gif" : e === "mp4" ? "video/mp4" : e === "pdf" ? "application/pdf" : "image/jpeg"; };

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async <T = Record<string, string>>(s: string) => (await db.query(s)).rows as T[];

/* 1) what the database references (distinct — legacy has duplicate document_attach rows) */
const refs: Ref[] = [];
const seen = new Set<string>();
const push = (r: Ref) => { const k = `${r.kind}|${r.key}|${r.file}`; if (!seen.has(k) && r.file && !r.file.includes("/")) { seen.add(k); refs.push(r); } };
for (const r of await q(`select product_code k, pictrue_file_name f from product where coalesce(pictrue_file_name,'') not in ('', 'no-image.gif')`)) push({ kind: "images", key: r.k, file: r.f, table: "product" });
for (const r of await q(`select reference_item_code k, system_file_name f from document_attach where reference_topic='Jobs' and coalesce(system_file_name,'')<>''`)) push({ kind: "attachments", key: r.k, file: r.f, table: "document_attach" });
for (const r of await q(`select sale_out_hd_no k, slip_file_name f from sale_out_hd where coalesce(slip_file_name,'')<>''`)) push({ kind: "slips", key: r.k, file: r.f, table: "sale_out_hd" });
for (const r of await q(`select job_no k, job_payment_slip_file_name f from job where coalesce(job_payment_slip_file_name,'')<>''`)) push({ kind: "slips", key: r.k, file: r.f, table: "job" });

/* 2) what the bucket already holds (one query — storage.objects lives in the same Postgres) */
const inBucket = new Set((await q<{ name: string }>(`select name from storage.objects where bucket_id='${BUCKET}'`)).map((r) => r.name));

/* 3) what the source folders hold (name → actual file; also lets .jpg refs match .jfif/.jpeg on disk) */
const listDir = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => !f.startsWith(".")) : []);
const stemMap = (files: string[]) => { const m = new Map<string, string>(); for (const f of files) { m.set(f, f); m.set(f.split(".")[0].toLowerCase(), f); } return m; };
const onDisk = { [IMAGES_DIR]: stemMap(listDir(IMAGES_DIR)), [FILES_DIR]: stemMap(listDir(FILES_DIR)) };
const findSrc = (r: Ref) => { const m = onDisk[srcDir(r)]; return m.get(r.file) ?? m.get(r.file.split(".")[0].toLowerCase()) ?? null; };

/* 4) classify */
type Row = Ref & { path: string; exists: boolean; src: string | null };
const rows: Row[] = refs.map((r) => ({ ...r, path: pathOf(r), exists: inBucket.has(pathOf(r)), src: findSrc(r) }));
const byKind = (k: Ref["kind"]) => rows.filter((r) => r.kind === k);
const fmtKind = (k: Ref["kind"]) => {
  const rs = byKind(k);
  const ok = rs.filter((r) => r.exists).length;
  const canUpload = rs.filter((r) => !r.exists && r.src).length;
  const missing = rs.filter((r) => !r.exists && !r.src);
  return { kind: k, referenced: rs.length, inBucket: ok, uploadable: canUpload, missingEverywhere: missing.length, missingSample: missing.slice(0, 5).map((r) => `${r.key}:${r.file}`) };
};
console.log(`bucket ${BUCKET} · objects ${inBucket.size} · sources: images=${onDisk[IMAGES_DIR].size ? IMAGES_DIR : "(not found)"} files=${onDisk[FILES_DIR].size ? FILES_DIR : "(not found)"}`);
console.table((["images", "attachments", "slips"] as const).map(fmtKind));

/* orphans: objects in the bucket no row points to (uploaded through the app for rows that are gone after a reload, or test uploads) */
const referencedPaths = new Set(rows.map((r) => r.path));
const orphans = [...inBucket].filter((p) => !referencedPaths.has(p) && !p.endsWith("/.emptyFolderPlaceholder"));
console.log(`orphans in bucket (no DB row points to them): ${orphans.length}${orphans.length ? " e.g. " + orphans.slice(0, 3).join(", ") : ""}`);

if (cmd === "validate") { await db.end(); process.exit(0); }

/* 5) upload */
const kinds: Ref["kind"][] = kindArg === "all" ? ["images", "attachments", "slips"] : [kindArg as Ref["kind"]];
const todo = rows.filter((r) => kinds.includes(r.kind) && r.src && (FORCE || !r.exists));
console.log(`\n${DRY ? "[dry-run] would upload" : "uploading"} ${todo.length} file(s) (${kinds.join(", ")})${FORCE ? " [force]" : ""}`);
if (DRY || !todo.length) { await db.end(); process.exit(0); }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ok = 0, done = 0; const failed: string[] = []; const queue = [...todo];
await Promise.all(Array.from({ length: CONC }, async () => {
  for (let r = queue.shift(); r; r = queue.shift()) {
    const body = fs.readFileSync(path.join(srcDir(r), r.src!));
    let err: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error } = await sb.storage.from(BUCKET).upload(r.path, body, { contentType: ct(r.src!), upsert: true });
      if (!error) { err = null; break; }
      err = error.message; await new Promise((res) => setTimeout(res, 500 * attempt));
    }
    if (err) failed.push(`${r.path}: ${err}`); else ok++;
    if (++done % 500 === 0) console.log(`  ${done}/${todo.length}`);
  }
}));
console.log({ uploaded: ok, failed: failed.length });
if (failed.length) console.log(failed.slice(0, 10).join("\n"));
await db.end();
process.exit(failed.length ? 1 : 0);
