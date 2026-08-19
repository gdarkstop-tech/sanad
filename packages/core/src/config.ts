/**
 * Configuration is validated at boot and fails fast (ARCHITECTURE.md §9).
 * No secret is ever hard-coded, and no default silently stands in for one.
 */
export interface AppConfig {
  databaseUrl: string;
  appSecret: string;
  sessionTtlDays: number;
  defaultLocale: string;
  isProduction: boolean;
}

const MIN_SECRET_LENGTH = 32;

export type EnvSource = Record<string, string | undefined>;

export function loadConfig(env: EnvSource = process.env): AppConfig {
  const missing: string[] = [];
  const invalid: string[] = [];

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) missing.push('DATABASE_URL');

  const appSecret = env.APP_SECRET;
  if (!appSecret) missing.push('APP_SECRET');
  else if (appSecret.length < MIN_SECRET_LENGTH) {
    invalid.push(`APP_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  const ttlRaw = env.SESSION_TTL_DAYS ?? '30';
  const sessionTtlDays = Number.parseInt(ttlRaw, 10);
  if (!Number.isFinite(sessionTtlDays) || sessionTtlDays <= 0) {
    invalid.push('SESSION_TTL_DAYS must be a positive integer');
  }

  if (missing.length || invalid.length) {
    const parts = [
      missing.length ? `missing: ${missing.join(', ')}` : '',
      invalid.length ? `invalid: ${invalid.join('; ')}` : '',
    ].filter(Boolean);
    throw new Error(
      `Configuration error (${parts.join(' | ')}). See .env.example.`,
    );
  }

  return {
    databaseUrl: databaseUrl as string,
    appSecret: appSecret as string,
    sessionTtlDays,
    defaultLocale: env.DEFAULT_LOCALE ?? 'en',
    isProduction: env.NODE_ENV === 'production',
  };
}
