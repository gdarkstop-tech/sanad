import { v7 as uuidv7 } from 'uuid';

/**
 * UUIDv7: non-sequential to the outside world, time-ordered internally so
 * B-tree locality does not collapse the way random v4 keys do (DATABASE.md §1).
 */
export function newId(): string {
  return uuidv7();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
