import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL, assertLocal } from './tests/db-url.mts';

// No env file is read. Anything that reaches for the app's connection lands on the test database,
// never on whatever the shell exported (tests/db-url.mts refuses all but a local *_test one).
assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
// Production's clock on any machine; workers inherit it.
process.env.TZ = 'Asia/Bangkok';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path('./src'),
      // src/server/* imports 'server-only', which throws outside a react-server build — its own empty module
      // stands in (what NODE_OPTIONS=--conditions=react-server picked for tsx)
      'server-only': path('./node_modules/server-only/empty.js'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.{ts,mts}', 'workers/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/db/**/*.test.{ts,mts}'],
          globalSetup: ['tests/db-global-setup.mts'],
          // One shared database: files must not run at once or they would wipe each other's rows mid-test.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
