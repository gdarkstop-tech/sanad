import { loadRootEnv } from '../packages/db/src/env';
import { runMigrations } from '../packages/db/src/migrate';

loadRootEnv();

/**
 * Migrations run once against the test database before any test file.
 * If they fail, every test fails loudly rather than each test failing
 * mysteriously on a missing table.
 */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env — see docs/DEVELOPMENT.md.',
    );
  }
  await runMigrations(url);
}
