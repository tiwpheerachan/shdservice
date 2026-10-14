/**
 * Startup check of the production environment (called from src/instrumentation.ts).
 * Without it a missing variable shows up only when someone first uses the feature
 * (sign-in fails, tracking closes). Prints variable NAMES and the consequence —
 * never a value.
 *
 * Default: warn in the log and keep running. ENV_STRICT=1 (set once the warnings
 * are gone) makes a production start fail instead, so Render keeps the old version.
 */
const has = (k: string) => !!(process.env[k] ?? "").trim();

/** variable → what breaks without it */
const REQUIRED: [string, string][] = [
  ["DATABASE_URL", "nothing works"],
  ["SESSION_SECRET", "nobody can sign in"],
  ["SSO_CLIENT_SECRET", "sign-in fails (server_not_configured)"],
  ["CENTRAL_API_KEY", "no directory profile / staff search"],
  ["NEXT_PUBLIC_SUPABASE_URL", "uploads and attachments fail"],
  ["APP_BASE_URL", "wrong links in QR codes / tracking links"],
  ["TURNSTILE_SECRET_KEY", "public tracking closed"],
  ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "public tracking closed"],
  ["TRACK_LOG_SECRET", "tracking rate limits reset on every restart"],
  ["OWNER_EMAILS", "no admin bootstrap on a fresh database"],
];

export function envProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const [k, why] of REQUIRED) if (!has(k)) out.push(`${k} missing — ${why}`);
  if (!has("SUPABASE_SECRET_KEY") && !has("SUPABASE_SERVICE_ROLE_KEY")) out.push("SUPABASE_SECRET_KEY missing — uploads and attachments fail");
  if (has("SESSION_SECRET") && (env.SESSION_SECRET ?? "").trim().length < 32) out.push("SESSION_SECRET shorter than 32 characters — sign-in refused");
  if (has("APP_BASE_URL") && !/^https:\/\/[^/]+\/?$/.test((env.APP_BASE_URL ?? "").trim())) out.push("APP_BASE_URL must be an https origin only (no path)");
  if (/^[123]x0{20,40}AA$/.test((env.TURNSTILE_SECRET_KEY ?? "").trim())) out.push("TURNSTILE_SECRET_KEY is a Cloudflare TEST key — tracking refuses it in production");
  const mode = (env.ORIGIN_AUTH_MODE ?? "").trim().toLowerCase();
  if (mode && !["off", "log", "enforce"].includes(mode)) out.push(`ORIGIN_AUTH_MODE "${mode}" is not off|log|enforce`);
  if (mode !== "off" && !has("ORIGIN_AUTH_SECRET")) out.push("ORIGIN_AUTH_SECRET missing — enforce answers 503 to everything");
  if ((env.SMS_PROVIDER ?? "").trim() === "log") out.push("SMS_PROVIDER=log — OTP refused in production");
  if (!has("THAIBULKSMS_OTP_KEY") || !has("THAIBULKSMS_OTP_SECRET")) out.push("THAIBULKSMS_OTP_KEY/SECRET missing — OTP tracking closed");
  if ((env.TZ ?? "") !== "Asia/Bangkok") out.push("TZ is not Asia/Bangkok — file names and local times are off by 7 h");
  return out;
}

/** Notes that are not problems but worth seeing once per start. */
export function envNotes(env: NodeJS.ProcessEnv = process.env): string[] {
  const mode = (env.ORIGIN_AUTH_MODE ?? "").trim().toLowerCase();
  return mode === "log" ? ["ORIGIN_AUTH_MODE=log — requests around Cloudflare are only logged (switch to enforce when origin_auth_failed stays quiet)"] : [];
}

/** Log the problems; with ENV_STRICT=1 refuse to start (Render keeps serving the old version). */
export async function checkEnv(): Promise<void> {
  const { log } = await import("@/lib/log");
  for (const note of envNotes()) log.warn("env note", { note });
  const problems = envProblems();
  if (!problems.length) return;
  if (process.env.ENV_STRICT === "1") {
    log.warn("env check failed — refusing to start (ENV_STRICT=1)", { problems });
    process.exit(1);
  }
  log.warn("env check: production is missing configuration", { problems });
}
