import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requireDatabaseUrl } from './env';
import * as schema from './schema/index';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString: string = requireDatabaseUrl()) {
  const sql = postgres(connectionString, { max: 10 });
  return drizzle(sql, { schema });
}

/** Opens its own connection; caller must close. Used by tests and scripts. */
export function createDisposableDatabase(connectionString: string) {
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end({ timeout: 5 }) };
}

let cached: Database | undefined;

/** Process-wide handle for the application. */
export function db(): Database {
  cached ??= createDatabase();
  return cached;
}
