import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id (ARCHITECTURE.md §3.7). Parameters follow the OWASP baseline:
 * 19 MiB memory, 2 iterations, 1 degree of parallelism.
 */
const PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, PARAMS);
}

/**
 * Never throws on a malformed stored hash — a corrupted row must read as a
 * failed sign-in, not a 500 that tells an attacker the account exists.
 */
export async function verifyPassword(
  storedHash: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext);
  } catch {
    return false;
  }
}
