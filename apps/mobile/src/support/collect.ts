import { Platform } from 'react-native';
import {
  fingerprintOf,
  hash64,
  SUPPORT_BUNDLE_VERSION,
  type SupportBundle,
} from '@homefarm/contracts';
import { SCHEMA_VERSION } from '@homefarm/core/db/migrations';
import { buildExport } from '@homefarm/core/export/csv';
import { diagnostics } from '@homefarm/core/sync/engine';
import { listRejected } from '@homefarm/core/sync/inbox';
import { readCachedClaims } from '../auth/session';
import { readLocalOrgId } from '../auth/local-org';
import { troubleHistory } from '../hooks/useTrouble';
import { APP_BUILD, APP_VERSION } from '../version';

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
  const [diag, rejections, org, signedIn] = await Promise.all([
    diagnostics(),
    rejectionShapes(),
    orgKey(),
    /**
     * Whether this device has a session, which is the difference between two
     * bugs that produce the same sentence — see `signedIn` in the schema.
     *
     * Failing soft: a bundle that could not be assembled because the keystore
     * was unhappy is a report nobody gets, and this is one boolean.
     */
    readCachedClaims().then(
      (claims) => claims !== null,
      () => undefined,
    ),
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
      ...(APP_BUILD === '' ? {} : { build: APP_BUILD }),
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
      ...(signedIn === undefined ? {} : { signedIn }),
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

/**
 * The other half — the farm's own records — assembled only on a yes (S2).
 *
 * **The same rows the Export screen already hands out.** Not a second read
 * path, and that is the point rather than a saving: a farm consenting to send
 * "your records" is entitled to have that phrase mean the same thing here as
 * it does on the screen where they can look at every row first. A bespoke dump
 * would be a second definition of the farm's data, and the wider of the two
 * would eventually be this one.
 *
 * Sheets rather than a database image: the escaping is proven by
 * `export.test.ts`, and the thirteen names are what a diagnosis needs to know
 * which read produced a wrong figure.
 *
 * Returns a string because that is what travels — see `supportTicketSchema`.
 * The server stores it and does not read it.
 */
export async function collectRecords(): Promise<string> {
  const sheets = await buildExport();

  return JSON.stringify({
    v: SUPPORT_BUNDLE_VERSION,
    at: Date.now(),
    app: { version: APP_VERSION, build: APP_BUILD, platform: Platform.OS },
    schemaVersion: SCHEMA_VERSION,
    sheets: sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows, csv: sheet.csv })),
  });
}

/**
 * Roughly how big that would be, for the sentence next to the question.
 *
 * Somebody agreeing to send their farm's records deserves to know whether that
 * is forty kilobytes or four megabytes before they agree, and a size is the
 * only honest way to say how much. Computed by building it, because an estimate
 * that disagreed with the thing sent would be worse than no number.
 */
export function sizeOf(records: string): string {
  const kb = Math.round(records.length / 1024);
  return kb < 1024 ? `${Math.max(1, kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}
