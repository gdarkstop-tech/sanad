import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadRootEnv } from './env';

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

/**
 * Applies migrations to the database named by DATABASE_URL, or by the first
 * CLI argument. Enables pgvector first — it is required by later phases and
 * costs nothing to enable now.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  loadRootEnv();
  const url = process.argv[2] ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL set and no connection string argument given.');
    process.exit(1);
  }
  runMigrations(url).then(
    () => {
      console.log('Migrations applied.');
      process.exit(0);
    },
    (error: unknown) => {
      console.error('Migration failed:', error);
      process.exit(1);
    },
  );
}
