import { defineConfig, devices } from '@playwright/test';
// First, and on purpose: importing it refuses a non-local database before anything is built.
import {
  APP_ORIGIN,
  APP_PORT,
  CENTRAL_API_KEY,
  NEXT_ENV,
  SSO_CLIENT_ID,
  SSO_CLIENT_SECRET,
  SSO_ORIGIN,
  SSO_PORT,
} from './tests/e2e/support/env';

/**
 * End-to-end tests: a production build in chromium, against the test database and a fake SSO
 * (modelled on OneLink). `npm run db:test:up && npm run db:test:prepare`, then `npm run e2e`.
 * No env file is read (tests/e2e/support/env.ts); the build goes to .next-e2e on port 3210.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/support/seed.ts',
  // one server, one database
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: APP_ORIGIN,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // every spec on a desktop, a phone and a tablet (touch, the sidebar behind เปิดเมนู below lg) — all chromium:
  // WebKit drops the app's Secure __Host- cookies over http://127.0.0.1, so it cannot sign in here; a shim would
  // rewrite every cookie and redirect — what auth.spec checks. WebKit needs the app over https first.
  // Desktop only: `npm run e2e -- --project=chromium`.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command: 'npx tsx tests/e2e/support/fake-sso.ts',
      url: `${SSO_ORIGIN}/health`,
      env: {
        FAKE_SSO_PORT: String(SSO_PORT),
        FAKE_SSO_REDIRECT_URI: `${APP_ORIGIN}/api/sso/callback`,
        SSO_CLIENT_ID,
        SSO_CLIENT_SECRET,
        CENTRAL_API_KEY,
      },
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      // built every run: a stale build would test yesterday's code
      command: `npx next build && npx next start -H 127.0.0.1 -p ${APP_PORT}`,
      url: `${APP_ORIGIN}/login`,
      env: NEXT_ENV,
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
  ],
});
