import { defineConfig } from 'drizzle-kit';
import { loadRootEnv } from './src/env';

loadRootEnv();

/**
 * Drizzle is the SOLE owner of the schema and migrations (ARCHITECTURE.md §3.3).
 * Other services read and write these tables but must never define or alter them.
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/sanad_dev',
  },
  strict: true,
  verbose: true,
});
