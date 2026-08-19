import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * One .env at the repo root serves every workspace package. Tools run from
 * different working directories (drizzle-kit from packages/db, vitest from the
 * root, Next from apps/web), so the file is located by walking up from this
 * module rather than trusting cwd.
 */
export function loadRootEnv(): void {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      applyEnvFile(candidate);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

/** Existing environment variables always win over the file. */
function applyEnvFile(file: string): void {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/**
 * Fail fast on missing configuration. A server that starts with a missing
 * secret and discovers it on the first request is worse than one that
 * refuses to start (ARCHITECTURE.md §9).
 */
export function requireDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) loadRootEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and configure it.',
    );
  }
  return url;
}
