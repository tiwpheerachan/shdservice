import { TEST_DATABASE_URL, assertLocal } from '../../db-url.mjs';

/**
 * Everything the e2e server is started with (modelled on OneLink's tests/e2e/support/env.ts).
 *
 * `.env` holds PRODUCTION, and `next build` / `next start` read it unless told not to:
 *   __NEXT_PROCESSED_ENV=true  @next/env treats the environment as loaded and reads no env file
 *   every variable, explicitly each process.env name under src/ has a value below, so nothing
 *                              falls through from the shell either
 * The database must be the local *_test one (tests/db-url.mts — exits otherwise) and the SSO
 * the fake; the Playwright config imports this module first, so both hold before any build.
 */

export const APP_PORT = 3210;
export const SSO_PORT = 4210;
export const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
export const SSO_ORIGIN = `http://127.0.0.1:${SSO_PORT}`;
/** apart from `.next`, so a `next dev` on :3000 is never touched */
export const DIST_DIR = '.next-e2e';

export const OWNER_EMAIL = 'owner@e2e.test';
/** seeded with the non-admin role E2E_ROLE (support/seed.ts) */
export const STAFF_EMAIL = 'staff@e2e.test';
export const E2E_ROLE = 'E2E Staff';

export const SSO_CLIENT_ID = 'oneservice-e2e';
export const SSO_CLIENT_SECRET = 'e2e-client-secret';
export const CENTRAL_API_KEY = 'e2e-central-api-key';

export const DATABASE_URL = TEST_DATABASE_URL;
assertLocal(DATABASE_URL);

/** what the app is started with: all of it, from here, nothing from a file */
export const SERVER_ENV = {
  DATABASE_URL,
  DB_POOL_MAX: '5',
  ALLOW_PROD_DB: '',
  APP_BASE_URL: APP_ORIGIN, // http, not https: src/server/env.ts only warns (ENV_STRICT unset)
  RENDER_EXTERNAL_URL: '',
  SSO_ORIGIN,
  SSO_CLIENT_ID,
  SSO_CLIENT_SECRET,
  CENTRAL_API_KEY, // set, so the directory lookup goes to the fake
  SSO_SESSION_CHECK: 'enforce',
  SSO_DEBUG: '',
  SESSION_SECRET: 'e2e-session-secret-0123456789abcdefghijklmnop',
  OWNER_EMAILS: OWNER_EMAIL,
  ORIGIN_AUTH_MODE: 'off',
  ORIGIN_AUTH_SECRET: '',
  // storage: a dead end on the fake SSO — no spec uploads, nothing can reach a real bucket
  NEXT_PUBLIC_SUPABASE_URL: `${SSO_ORIGIN}/no-storage`,
  SUPABASE_SECRET_KEY: 'e2e-no-storage',
  SUPABASE_SERVICE_ROLE_KEY: '',
  SUPABASE_STORAGE_BUCKET: 'oneservice-e2e',
  // Cloudflare's always-pass test keys — production refuses them, so /track stays closed here
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000BB',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_EXPECTED_HOSTNAME: '',
  TRACK_LOG_SECRET: 'e2e-track-log-secret',
  SMS_PROVIDER: 'log', // refused in production too: no OTP
  THAIBULKSMS_OTP_KEY: '',
  THAIBULKSMS_OTP_SECRET: '',
  ENV_STRICT: '',
  TZ: 'Asia/Bangkok',
};

/** for both commands — build and start */
export const NEXT_ENV = {
  ...SERVER_ENV,
  __NEXT_PROCESSED_ENV: 'true',
  NEXT_DIST_DIR: DIST_DIR,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
};
