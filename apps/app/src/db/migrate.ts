import { MUTATION_SCHEMA_VERSION } from '@steading/contracts';

/**
 * Envelope migration (A7).
 *
 * A device offline for three weeks across two deploys reopens holding
 * mutations written by an older build. The storage schema migrates in
 * open.ts; this migrates what is *inside* a queued envelope.
 *
 * Kept as a ladder rather than a single upgrade function so each step stays
 * small and independently testable, and so a device that skipped several
 * versions walks through every one of them in order.
 */

export type EnvelopeMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version being migrated FROM. An entry at key N takes a v-N
 * envelope and returns a v-(N+1) one.
 *
 * Empty today: MUTATION_SCHEMA_VERSION is 1 and nothing has shipped before it.
 * The ladder exists so that when v2 arrives there is one obvious place to put
 * the step, and the walk below is already proven by test.
 */
export const ENVELOPE_MIGRATIONS: Record<number, EnvelopeMigration> = {};

export class UnmigratableEnvelopeError extends Error {
  readonly from: number;

  constructor(from: number) {
    super(`No migration from mutation schema v${from}.`);
    this.name = 'UnmigratableEnvelopeError';
    this.from = from;
  }
}

/**
 * Walks an envelope up to the current version.
 *
 * A version from the future is returned untouched: a newer build wrote it, and
 * guessing at a shape we do not know would corrupt real work. It will be
 * rejected at flush with a message the user can act on, which is the honest
 * outcome.
 */
export function migrateEnvelope(
  raw: Record<string, unknown>,
  migrations: Record<number, EnvelopeMigration> = ENVELOPE_MIGRATIONS,
  target: number = MUTATION_SCHEMA_VERSION,
): Record<string, unknown> {
  const start = raw.schemaVersion;
  if (typeof start !== 'number' || !Number.isInteger(start)) {
    throw new UnmigratableEnvelopeError(Number.NaN);
  }

  if (start >= target) return raw;

  let current = raw;
  for (let version = start; version < target; version++) {
    const step = migrations[version];
    if (!step) throw new UnmigratableEnvelopeError(version);

    current = { ...step(current), schemaVersion: version + 1 };
  }

  return current;
}
