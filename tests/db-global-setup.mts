import { TEST_DATABASE_URL, assertLocal } from './db-url.mts';

/** The db project refuses to start against anything but a local *_test database. */
export default function setup() {
  assertLocal(TEST_DATABASE_URL);
}
