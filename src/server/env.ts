/**
 * Check of the production environment (src/instrumentation.ts — Next runs it on the
 * first request after `next start`). Without it a missing variable shows up only when
 * someone first uses the feature. Prints variable NAMES and the consequence, never a value.
 *
 * REQUIRED = the app is broken without it. OPTIONAL = one feature is off without it (OTP,
 * directory search, uploads…) — always only a warning. With ENV_STRICT=1 a REQUIRED problem
 * exits the process: the health check fails and Render keeps the old version.
 */
import { log } from '@/lib/log';

const env = process.env;
const has = (k: string) => !!(env[k] ?? '').trim();

export function envProblems(): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];
  const need = (k: string, why: string) => has(k) || required.push(`${k} missing — ${why}`);
  const want = (k: string, why: string) => has(k) || optional.push(`${k} missing — ${why}`);

  need('DATABASE_URL', 'nothing works');
  need('SESSION_SECRET', 'nobody can sign in');
  need('SSO_CLIENT_SECRET', 'sign-in fails (server_not_configured)');
  need('APP_BASE_URL', 'wrong customer tracking links');
  if (has('SESSION_SECRET') && (env.SESSION_SECRET ?? '').trim().length < 32)
    required.push('SESSION_SECRET shorter than 32 characters — sign-in refused');
  if (has('APP_BASE_URL') && !/^https:\/\/[^/]+\/?$/.test((env.APP_BASE_URL ?? '').trim()))
    required.push('APP_BASE_URL must be an https origin only (no path)');
  const mode = (env.ORIGIN_AUTH_MODE ?? '').trim().toLowerCase();
  if (mode && !['off', 'log', 'enforce'].includes(mode))
    required.push(`ORIGIN_AUTH_MODE "${mode}" is not off|log|enforce`);
  if (mode !== 'off' && !has('ORIGIN_AUTH_SECRET'))
    required.push('ORIGIN_AUTH_SECRET missing — enforce answers 503 to everything');
  // the client secret is POSTed there on every sign-in — never over plain http in production
  if (has('SSO_ORIGIN') && !/^https:\/\//.test((env.SSO_ORIGIN ?? '').trim()))
    required.push('SSO_ORIGIN must be https — the SSO client secret is sent there');
  if ((env.TZ ?? '') !== 'Asia/Bangkok')
    required.push('TZ is not Asia/Bangkok — file names and local times are off by 7 h');

  want('NEXT_PUBLIC_SUPABASE_URL', 'uploads and attachments fail');
  if (!has('SUPABASE_SECRET_KEY') && !has('SUPABASE_SERVICE_ROLE_KEY'))
    optional.push('SUPABASE_SECRET_KEY missing — uploads and attachments fail');
  const r2 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter((k) => !has(k));
  if (r2.length)
    optional.push(`${r2.join(' / ')} missing — no video attachments (Cloudflare R2; the video API answers 503)`);
  // the media Worker (workers/media, docs/cloudflare-cdn.md): both or neither — one alone = videos from R2 directly
  if (has('MEDIA_BASE_URL') !== has('MEDIA_SIGNING_KEY'))
    optional.push('only one of MEDIA_BASE_URL / MEDIA_SIGNING_KEY set — videos skip the media CDN (presigned R2)');
  if (has('MEDIA_BASE_URL') && !/^https:\/\/[^/]+\/?$/.test((env.MEDIA_BASE_URL ?? '').trim()))
    optional.push('MEDIA_BASE_URL must be an https origin only (no path) — the CSP will not allow its videos');
  if (has('MEDIA_SIGNING_KEY') && (env.MEDIA_SIGNING_KEY ?? '').trim().length < 32)
    optional.push('MEDIA_SIGNING_KEY shorter than 32 characters — use openssl rand -hex 32');
  want('CENTRAL_API_KEY', 'no directory profile / staff search');
  want('TURNSTILE_SECRET_KEY', 'public tracking closed');
  want('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public tracking closed');
  want('TRACK_LOG_SECRET', 'tracking rate limits reset on every restart');
  want('OWNER_EMAILS', 'no admin bootstrap on a fresh database');
  if (/supabase|pooler/.test(env.DATABASE_URL ?? '') && !has('DB_SSL_CA'))
    optional.push('DB_SSL_CA missing — the database TLS certificate is not verified (src/db/ssl.ts)');
  if (/^[123]x0{20,40}AA$/.test((env.TURNSTILE_SECRET_KEY ?? '').trim()))
    optional.push('TURNSTILE_SECRET_KEY is a Cloudflare TEST key — tracking refuses it in production');
  if ((env.SMS_PROVIDER ?? '').trim() === 'log') optional.push('SMS_PROVIDER=log — OTP refused in production');
  if (!has('THAIBULKSMS_OTP_KEY') || !has('THAIBULKSMS_OTP_SECRET'))
    optional.push('THAIBULKSMS_OTP_KEY/SECRET missing — OTP tracking closed');
  // MAINTENANCE_MODE=1 (+ optional MAINTENANCE_UNTIL, MAINTENANCE_BYPASS_SECRET) — src/lib/maintenance.ts
  if ((env.MAINTENANCE_MODE ?? '').trim() === '1') {
    optional.push(
      'MAINTENANCE_MODE=1 — every page and API answers 503 (ระบบปิดปรับปรุง); unset it and redeploy to open',
    );
    if ((env.MAINTENANCE_BYPASS_SECRET ?? '').trim().length < 16)
      optional.push(
        'MAINTENANCE_BYPASS_SECRET missing or under 16 characters — nobody can check the system before opening',
      );
  }
  if (has('RATE_LIMIT_SCALE'))
    optional.push(`RATE_LIMIT_SCALE=${env.RATE_LIMIT_SCALE} — every per-user rate limit raised (meant for e2e only)`);
  if (mode === 'log' || mode === 'off')
    optional.push(`ORIGIN_AUTH_MODE=${mode} — requests around Cloudflare are not refused`);
  return { required, optional };
}

/** Log the problems; with ENV_STRICT=1 a REQUIRED problem exits (Render keeps the old version). */
export function checkEnv(): void {
  const { required, optional } = envProblems();
  if (optional.length) log.warn('env check: optional configuration missing', { problems: optional });
  if (!required.length) return;
  if (env.ENV_STRICT === '1') {
    log.warn('env check failed — exiting (ENV_STRICT=1)', { problems: required });
    process.exit(1);
  }
  log.warn('env check: production is missing REQUIRED configuration', { problems: required });
}
