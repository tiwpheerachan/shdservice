/**
 * Check of the production environment (src/instrumentation.ts — Next runs it on the
 * first request after `next start`). Without it a missing variable shows up only when
 * someone first uses the feature. Prints variable NAMES and the consequence, never a value.
 *
 * REQUIRED = the app is broken without it. OPTIONAL = one feature is off without it (OTP,
 * directory search, uploads…) — always only a warning. With ENV_STRICT=1 a REQUIRED problem
 * exits the process: the health check fails and Render keeps the old version.
 */
import { log } from "@/lib/log";

const env = process.env;
const has = (k: string) => !!(env[k] ?? "").trim();

export function envProblems(): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];
  const need = (k: string, why: string) => has(k) || required.push(`${k} missing — ${why}`);
  const want = (k: string, why: string) => has(k) || optional.push(`${k} missing — ${why}`);

  need("DATABASE_URL", "nothing works");
  need("SESSION_SECRET", "nobody can sign in");
  need("SSO_CLIENT_SECRET", "sign-in fails (server_not_configured)");
  need("APP_BASE_URL", "wrong customer tracking links");
  if (has("SESSION_SECRET") && (env.SESSION_SECRET ?? "").trim().length < 32) required.push("SESSION_SECRET shorter than 32 characters — sign-in refused");
  if (has("APP_BASE_URL") && !/^https:\/\/[^/]+\/?$/.test((env.APP_BASE_URL ?? "").trim())) required.push("APP_BASE_URL must be an https origin only (no path)");
  const mode = (env.ORIGIN_AUTH_MODE ?? "").trim().toLowerCase();
  if (mode && !["off", "log", "enforce"].includes(mode)) required.push(`ORIGIN_AUTH_MODE "${mode}" is not off|log|enforce`);
  if (mode !== "off" && !has("ORIGIN_AUTH_SECRET")) required.push("ORIGIN_AUTH_SECRET missing — enforce answers 503 to everything");
  // the client secret is POSTed there on every sign-in — never over plain http in production
  if (has("SSO_ORIGIN") && !/^https:\/\//.test((env.SSO_ORIGIN ?? "").trim())) required.push("SSO_ORIGIN must be https — the SSO client secret is sent there");
  if ((env.TZ ?? "") !== "Asia/Bangkok") required.push("TZ is not Asia/Bangkok — file names and local times are off by 7 h");

  want("NEXT_PUBLIC_SUPABASE_URL", "uploads and attachments fail");
  if (!has("SUPABASE_SECRET_KEY") && !has("SUPABASE_SERVICE_ROLE_KEY")) optional.push("SUPABASE_SECRET_KEY missing — uploads and attachments fail");
  want("CENTRAL_API_KEY", "no directory profile / staff search");
  want("TURNSTILE_SECRET_KEY", "public tracking closed");
  want("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "public tracking closed");
  want("TRACK_LOG_SECRET", "tracking rate limits reset on every restart");
  want("OWNER_EMAILS", "no admin bootstrap on a fresh database");
  if (/supabase|pooler/.test(env.DATABASE_URL ?? "") && !has("DB_SSL_CA")) optional.push("DB_SSL_CA missing — the database TLS certificate is not verified (src/db/ssl.ts)");
  if (/^[123]x0{20,40}AA$/.test((env.TURNSTILE_SECRET_KEY ?? "").trim())) optional.push("TURNSTILE_SECRET_KEY is a Cloudflare TEST key — tracking refuses it in production");
  if ((env.SMS_PROVIDER ?? "").trim() === "log") optional.push("SMS_PROVIDER=log — OTP refused in production");
  if (!has("THAIBULKSMS_OTP_KEY") || !has("THAIBULKSMS_OTP_SECRET")) optional.push("THAIBULKSMS_OTP_KEY/SECRET missing — OTP tracking closed");
  if (mode === "log" || mode === "off") optional.push(`ORIGIN_AUTH_MODE=${mode} — requests around Cloudflare are not refused`);
  return { required, optional };
}

/** Log the problems; with ENV_STRICT=1 a REQUIRED problem exits (Render keeps the old version). */
export function checkEnv(): void {
  const { required, optional } = envProblems();
  if (optional.length) log.warn("env check: optional configuration missing", { problems: optional });
  if (!required.length) return;
  if (env.ENV_STRICT === "1") {
    log.warn("env check failed — exiting (ENV_STRICT=1)", { problems: required });
    process.exit(1);
  }
  log.warn("env check: production is missing REQUIRED configuration", { problems: required });
}
