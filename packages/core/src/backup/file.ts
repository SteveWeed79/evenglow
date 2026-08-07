import {
  BACKUP_EXCLUDES,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupEntry,
  type BackupFile,
  ENTITIES,
  MUTATION_SCHEMA_VERSION,
  payloadSchemaFor,
} from '@steading/contracts';
import { localStore } from '../db/store';

/**
 * Writing the file. Reading it is `restore.ts`; the two are apart on purpose.
 *
 * Building a backup touches nothing and can run whenever. Restoring one
 * changes which farm a handset is looking at. Keeping them in one module would
 * make it easy for a screen to import the dangerous half by accident, and the
 * export screen has no business being able to.
 *
 * ## Built from the projection, not from the outbox
 *
 * The outbox is not a history: a mutation leaves it the moment the server
 * acknowledges it (`clearedCount` counts them), so a farm that has ever synced
 * has an outbox holding only what has not gone up yet. The projection is the
 * farm — every record, at its current value, whether it came from this device
 * or arrived from another one through a pull.
 */

/** What a backup is worth saying about before it is written. */
export interface BackupSummary {
  entries: number;
  /** Records the projection holds but that will not go in, and why. See `buildBackup`. */
  unreadable: number;
  archived: number;
}

export interface BuiltBackup {
  file: BackupFile;
  summary: BackupSummary;
}

/**
 * Every record this device holds, as entries.
 *
 * ## Validated on the way OUT, which is the unusual half
 *
 * A record that will not parse against its own create schema cannot be
 * restored — `enqueue` would refuse it, and it would be refused one at a time
 * in the middle of a restore where nobody can do anything about it. Checking
 * here means the count is known before the file is written and can be said on
 * the screen that writes it.
 *
 * There is one honest way to hold such a record. `db/project.ts` documents it:
 * an update that reached a device before its create leaves a partial value,
 * complete enough for the row to exist and not complete enough to be a record.
 * On an unclaimed farm this cannot happen at all — nothing is ever pulled —
 * so `unreadable` is expected to be zero and is worth showing when it is not.
 */
export async function buildBackup(orgId: string, app: string): Promise<BuiltBackup> {
  const store = localStore();
  const entries: BackupEntry[] = [];
  let unreadable = 0;
  let archived = 0;

  for (const entity of ENTITIES) {
    // `create`, always — a restore rebuilds a record rather than replaying the
    // edits that shaped it. An entity with no create schema does not exist.
    const schema = payloadSchemaFor(entity, 'create');
    if (schema === undefined) continue;

    for (const record of await store.readRecordsByEntity(entity)) {
      const parsed = schema.safeParse(record.value);
      if (!parsed.success) {
        unreadable += 1;
        continue;
      }

      if (record.deleted) archived += 1;

      entries.push({
        entity,
        targetId: record.targetId,
        payload: parsed.data,
        at: record.updatedAt,
        // Absent rather than false, so the common case costs nothing per row
        // in a file that is mostly rows.
        ...(record.deleted ? { archived: true } : {}),
      });
    }
  }

  /**
   * Oldest first.
   *
   * Nothing depends on it — the projection is keyed by entity and id, and the
   * server's appliers do not look at order either. It is here because a file
   * somebody opens in a text editor should read like the farm happened, and
   * because a diff between two backups of the same farm is then a tail rather
   * than a reshuffle.
   */
  entries.sort((a, b) => a.at - b.at || a.targetId.localeCompare(b.targetId));

  return {
    file: {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      mutationSchemaVersion: MUTATION_SCHEMA_VERSION,
      orgId,
      writtenAt: Date.now(),
      app,
      excludes: [...BACKUP_EXCLUDES],
      entries,
    },
    summary: { entries: entries.length, unreadable, archived },
  };
}

/**
 * The file as text.
 *
 * Indented, and the two spaces are worth the bytes. A farm's backup is
 * something they may open to satisfy themselves it is not empty, and a single
 * 800 KB line is indistinguishable from a corrupt file to anybody who does
 * that. Gzip would take most of it back and there is no gzip on this platform
 * without a dependency.
 */
export function serialiseBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * `steading-farm-2026-08-07.json`.
 *
 * Dated, because the file leaves the app and has to say what it is from the
 * outside — the same argument the CSV export makes. Not named for the org id:
 * it is twenty-six characters of nothing to a person, and the id is inside the
 * file where the restore reads it.
 */
export function backupFilename(at: number): string {
  return `steading-farm-${new Date(at).toISOString().slice(0, 10)}.json`;
}
