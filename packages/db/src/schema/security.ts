import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from './identity';

/**
 * Fixed-window rate limiting, stored in Postgres.
 *
 * Redis would be the reflex here, but it would be a second service to run for
 * a counter that is written a few times per sign-in attempt. Postgres already
 * runs, the window rows are tiny, and an upsert is atomic — see
 * ARCHITECTURE.md §3.4 for the same reasoning applied to the job queue.
 */
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    /** e.g. "login:ip:203.0.113.5" or "login:email:a@b.edu" */
    bucketKey: text('bucket_key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('rate_limit_buckets_key_window_key').on(t.bucketKey, t.windowStart),
    index('rate_limit_buckets_expiry_idx').on(t.expiresAt),
  ],
);

/**
 * Email verification. Only the hash is stored, exactly as with session tokens:
 * a database leak must not yield usable verification links.
 */
export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_verification_user_idx').on(t.userId)],
);
