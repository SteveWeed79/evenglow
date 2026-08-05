import { Platform } from 'react-native';
import {
  fingerprintOf,
  hash64,
  SUPPORT_BUNDLE_VERSION,
  type SupportBundle,
} from '@steading/contracts';
import { SCHEMA_VERSION } from '@steading/core/db/migrations';
import { diagnostics } from '@steading/core/sync/engine';
import { listRejected } from '@steading/core/sync/inbox';
import { readCachedClaims } from '../auth/session';
import { readLocalOrgId } from '../auth/local-org';
import { troubleHistory } from '../hooks/useTrouble';
import { APP_VERSION } from '../version';

/**
 * Assembling the lean bundle (`docs/SUPPORT-LOOP.md` S1 and S2).
 *
 * **Structure and counts, never content.** No email, no farm name, no
 * coordinates, no record values — and the contract is `.strict()`, so a field
 * nobody described cannot ride along even by accident. That is what makes this
 * half safe to file on a repository whose visibility may change.
 *
 * It is also, usefully, most of what a diagnosis needs: the queue depth, the
 * schema version, which mutations were refused and why, and what the engine
 * threw. All of it already on the device, none of it typed by anybody.
 *
 * The farm's records are the other half and travel only on a yes — see
 * `recordsFor`.
 */

/**
 * Rejections, reduced to shapes and counted.
 *
 * The payload is the farm's data and does not belong in the lean bundle at any
 * price; the entity, the op and the reason are what identify the applier that
 * refused it. Counted, because forty rows refused for one reason is one defect
 * and forty entries would crowd out the other three.
 */
async function rejectionShapes(): Promise<SupportBundle['rejections']> {
  const rows = await listRejected();
  const byShape = new Map<string, SupportBundle['rejections'][number]>();

  for (const row of rows) {
    const reason = (row.rejectedReason ?? 'unknown').slice(0, 300);
    const key = `${row.entity}|${row.op}|${reason}`;
    const seen = byShape.get(key);

    if (seen === undefined) {
      byShape.set(key, { entity: row.entity, op: row.op, reason, count: 1 });
    } else {
      seen.count += 1;
    }
  }

  return [...byShape.values()].slice(0, 20);
}

/**
 * The farm, as a correlation key and nothing more.
 *
 * Hashed rather than sent, so two reports can be recognised as coming from one
 * farm without the ticket naming a customer. `hash64` is not cryptographic and
 * does not need to be — nobody is trying to reverse a ULID out of it, and the
 * property that matters is that the same farm produces the same key twice.
 */
async function orgKey(): Promise<string | undefined> {
  const claims = await readCachedClaims();
  const orgId = claims?.orgId ?? (await readLocalOrgId());
  return orgId === null || orgId === undefined ? undefined : hash64(`org:${orgId}`);
}

export async function collectBundle(said?: string): Promise<SupportBundle> {
  const [diag, rejections, org] = await Promise.all([
    diagnostics(),
    rejectionShapes(),
    orgKey(),
  ]);

  /**
   * The engine's own failures, from the history rather than the banner.
   *
   * `clearTrouble` fires the moment a later read succeeds, so the banner is
   * usually empty by the time somebody has walked to the support screen. The
   * history is what a ticket is actually about.
   */
  const errors = troubleHistory()
    .slice(0, 20)
    .map((record) => ({
      where: record.where.slice(0, 120),
      message: record.message.slice(0, 500),
      count: record.count,
    }));

  const said_ = said?.trim();

  return {
    v: SUPPORT_BUNDLE_VERSION,
    at: Date.now(),
    app: {
      version: APP_VERSION,
      platform: Platform.OS,
      ...(typeof Platform.Version === 'string' || typeof Platform.Version === 'number'
        ? { os: String(Platform.Version).slice(0, 60) }
        : {}),
    },
    store: {
      schemaVersion: SCHEMA_VERSION,
      /**
       * Only when the ledger does not balance.
       *
       * `missing` is positive when records left storage without the server
       * acknowledging them, which is the one integrity fact worth a ticket —
       * and a bundle that carried the four counters on every report would be
       * four numbers nobody reads standing in front of the one that matters.
       */
      ...(diag.integrity.missing > 0 ? { integrity: `missing:${diag.integrity.missing}` } : {}),
    },
    sync: {
      queued: diag.queued,
      rejected: diag.rejected,
      quarantined: diag.quarantined,
      cleared: diag.integrity.cleared,
      lastSyncAt: diag.lastSyncAt,
      // Truncated rather than dropped: the last error is frequently the whole
      // report, and it is a message this app wrote.
      lastError: diag.lastError === null ? null : diag.lastError.slice(0, 300),
      online: diag.online,
    },
    rejections,
    errors,
    ...(org === undefined ? {} : { org }),
    ...(said_ === undefined || said_ === '' ? {} : { said: said_.slice(0, 500) }),
    fingerprint: fingerprintOf({
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      errors,
      rejections,
      ...(said_ === undefined || said_ === '' ? {} : { said: said_ }),
    }),
  };
}
