/**
 * IndexedDB specifics, over the shared shapes.
 *
 * Everything the engine actually stores — the queued mutation, the local
 * record, the quarantine row, the meta keys — lives in
 * `@homefarm/app/db/schema` and is re-exported here. Only the three constants
 * below are about IndexedDB in particular, and they go with the rest of the
 * browser engine in S7.
 *
 * The shapes are shared rather than copied because the same suite runs against
 * both storage layers during the migration, and two declarations of a stored
 * shape is exactly how the two would come to disagree.
 */

export * from './schema';

export const DB_NAME = 'homefarm';

/**
 * Bumping this runs the migration ladder in open.ts. Migrations are additive
 * only — an append-only outbox must never be destructively migrated, which is
 * the cheap answer to the one failure mode a second local store would cover
 * (masterplan Q1).
 */
export const DB_VERSION = 2;

export const STORES = {
  outbox: 'outbox',
  records: 'records',
  meta: 'meta',
  quarantine: 'quarantine',
} as const;
