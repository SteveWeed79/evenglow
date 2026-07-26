import { ulid } from 'ulid';
import { ULID_PATTERN } from './contracts/mutation';

/**
 * All syncable entity IDs are minted here, on the client, before the server
 * ever sees them (D1). Offline records must be able to reference each other
 * immediately, and a replayed batch must be a no-op rather than a duplicate.
 */
export function newId(): string {
  return ulid();
}

export function isUlid(value: string): boolean {
  return value.length === 26 && ULID_PATTERN.test(value);
}
