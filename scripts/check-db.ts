import postgres from 'postgres';
import { loadRootEnv } from '../packages/db/src/env';

/**
 * Can we reach PostgreSQL, and does it have pgvector?
 *
 * Setup fails on these two things more than anything else, and the errors
 * PostgreSQL gives are not the ones a person can act on. This says what is
 * wrong and what to do about it.
 */
loadRootEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 8 });

try {
  const [version] = await sql<{ v: string }[]>`SELECT version() AS v`;
  console.log(version?.v.split(',')[0] ?? 'connected');

  const [available] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_available_extensions WHERE name = 'vector'
  `;
  if (!available?.n) {
    console.error(
      '\npgvector is not available on this server.\n' +
        '  Debian/Ubuntu:  sudo apt-get install -y postgresql-16-pgvector\n' +
        '  macOS/Homebrew: brew install pgvector\n' +
        '  Or use the bundled image: bash scripts/setup.sh --docker',
    );
    process.exit(1);
  }
  console.log('pgvector: available');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nCould not connect: ${message}`);
  if (/ECONNREFUSED/.test(message)) {
    console.error('PostgreSQL does not appear to be running on that host and port.');
    console.error('Start it, or run: bash scripts/setup.sh --docker');
  }
  if (/database .* does not exist/i.test(message)) {
    console.error('Create it with: createdb sanad_dev && createdb sanad_test');
  }
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
