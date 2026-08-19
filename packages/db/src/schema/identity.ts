import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { authProvider, userRole } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    email: text('email').notNull(),
    /** Lowercased, trimmed. Uniqueness is enforced here, not on `email`. */
    emailNormalized: text('email_normalized').notNull(),
    role: userRole('role').notNull().default('student'),
    fullName: text('full_name').notNull(),
    /** Preferred application language (BCP-47). Independent of content language. */
    interfaceLocale: text('interface_locale').notNull().default('en'),
    /** Required for scheduling; a plan in the wrong timezone is a wrong plan. */
    timezone: text('timezone').notNull().default('UTC'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [unique('users_email_normalized_key').on(t.emailNormalized)],
);

/**
 * Credentials live here rather than on `users` so federated providers can be
 * added as a new row type instead of a user-table migration — ARCHITECTURE.md §3.7.
 */
export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: authProvider('provider').notNull(),
    /** Normalized email for 'password'; subject id for federated providers. */
    providerAccountId: text('provider_account_id').notNull(),
    /** Argon2id. Null for federated identities — enforced by the check below. */
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    unique('auth_identities_provider_account_key').on(t.provider, t.providerAccountId),
    index('auth_identities_user_idx').on(t.userId),
    check(
      'auth_identities_password_ck',
      sql`(${t.provider} = 'password') = (${t.passwordHash} IS NOT NULL)`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the cookie token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
  },
  (t) => [
    unique('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId, t.expiresAt),
  ],
);

/**
 * Consent is versioned so a policy change can require re-acknowledgement —
 * DATABASE.md §16. Recording is blocked until 'recording' is granted.
 */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    consentType: text('consent_type').notNull(),
    policyVersion: text('policy_version').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    unique('consents_user_type_version_key').on(t.userId, t.consentType, t.policyVersion),
  ],
);

export const isVerifiedColumn = boolean;
