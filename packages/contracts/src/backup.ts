import { z } from 'zod';
import { entitySchema, MUTATION_SCHEMA_VERSION } from './mutation';
import { PRODUCT_NAME } from './product';

/**
 * A farm's records, as a file it can carry to another phone.
 *
 * ## Why this exists, and why it is not the CSV
 *
 * `GET /snapshot` is the recovery path and it works: sign in on a new handset
 * and the server rebuilds the database. Pull is deliberately ungated on
 * billing, so a lapsed subscription is never the reason a farm cannot get its
 * records back.
 *
 * That leaves exactly one farm with no way home: the one that never made an
 * account (A2.1). Its records live in `homefarm-{orgId}.db` on one handset and
 * nowhere else, and Android hands an app no callback before it is uninstalled
 * — so there is no moment to warn at. The only version that works is a copy
 * the farm can take whenever it likes.
 *
 * The CSV export cannot be that copy. It is built for a vet and an accountant:
 * it resolves ids to names (an archived group comes out as the literal string
 * `(archived)`), it carries no id column at all, it rounds times to the
 * minute, and it covers thirteen sheets — no plantings, beds, incubations,
 * tasks, inventory, notes or feed plans. Reading it back would be inventing
 * data.
 *
 * ## This is not the CSV import that was refused
 *
 * `docs/ROADMAP.md` refuses CSV import, not deferred, for three reasons.
 * None of them survives contact with this file:
 *
 * - *"conflict rules"* — a restore goes into a farm with nothing to conflict
 *   with. It refuses outright if the device holds any record the file does
 *   not.
 * - *"an id strategy for rows that have none"* — every entry carries the ULID
 *   the record was minted with (D1). There is nothing to invent, and that is
 *   also what makes a restore idempotent at every layer: a `create` at a
 *   targetId that already exists is a `noop` locally and a `noop` on the
 *   server (`sync/projections.ts`).
 * - *"a preview nobody reads"* — there is nothing to preview. The file is this
 *   app's own output and the restore is all-or-nothing.
 *
 * ## What is deliberately not in it
 *
 * **Photographs.** The bytes live beside the database, a single receipt is
 * larger than a year of records, and a backup that quietly grew to 300 MB is
 * one that fails to send with no explanation. The file says so in `excludes`
 * and so does the screen that writes it.
 *
 * Nothing derived is in it either — the forecast cache, due dates, the bundled
 * breed and variety library — because all of it is recomputed and a stale copy
 * would be worse than none. Neither is the device's own bookkeeping: the
 * device id and the client sequence belong to the handset that is being left
 * behind, and a restore is a different device.
 */

export const BACKUP_FORMAT = 'homefarm.farm-records';

/**
 * Bumped when the shape changes in a way an older app cannot read.
 *
 * Separate from `MUTATION_SCHEMA_VERSION`, which is also recorded: this
 * number is about the envelope around the entries, that one is about the
 * entries themselves. An app can perfectly well gain a new backup field while
 * the records inside are unchanged, and conflating the two would strand files
 * for no reason.
 */
export const BACKUP_FORMAT_VERSION = 1;

/** Named in `excludes`, so the file states its own limits rather than a screen doing it. */
export const BACKUP_EXCLUDES = ['photographs'] as const;

/**
 * One record, as the mutation that recreates it.
 *
 * `payload` is the projection's current value rather than the history that
 * produced it. A group created and then edited four times restores as one
 * create carrying what it looks like now, which is both smaller and more
 * correct than replaying four mutations — the intermediate states are not
 * facts anybody needs back.
 *
 * `archived` carries the one bit that a create cannot: a record retired with
 * P13's archive-never-delete is still history and must come back retired.
 */
export const backupEntrySchema = z
  .object({
    entity: entitySchema,
    targetId: z.string().length(26),
    /** Validated per entity at restore time, by the same schema the queue uses. */
    payload: z.unknown(),
    /** When the record last changed. Ordering only — nothing depends on it. */
    at: z.number().int(),
    archived: z.boolean().optional(),
  })
  .strict();

export type BackupEntry = z.infer<typeof backupEntrySchema>;

/**
 * The file.
 *
 * `.strict()` throughout, because this is external data of the most hostile
 * kind (invariant 11): it has been on a filesystem, in a messaging app, and
 * possibly through a text editor. An unknown key is a file this app did not
 * write, or one it wrote in a version that knows something this one does not,
 * and both are refusals rather than things to guess at.
 */
export const backupFileSchema = z
  .object({
    /** A literal, so a JSON file that is not one of ours is refused on the first key. */
    format: z.literal(BACKUP_FORMAT),
    formatVersion: z.number().int().positive(),
    /** What the payloads inside conform to, so a restore can refuse a future one. */
    mutationSchemaVersion: z.number().int().positive(),
    /**
     * Which farm wrote it.
     *
     * **Recorded, not used to choose a database, and the honest version of
     * that is worth stating.** A restore lands the records in whatever farm
     * the target handset is already on; it does not reopen
     * `homefarm-{this}.db`. For the only farm this feature exists for — one
     * that never made an account — the id is arbitrary either way: nothing on
     * a server has ever heard of it, and the id the device later claims is
     * whichever one it is holding (A2.2).
     *
     * It is in the file because it identifies the source when two backups turn
     * up in one place, because a support report can name it, and because
     * adopting it on restore is a real improvement that needs its own design
     * pass — reopening the store mid-restore can strand both farms if it
     * fails, and that is not decidable off a handset.
     */
    orgId: z.string().length(26),
    writtenAt: z.number().int(),
    /** Which build wrote it. The first question about any file that will not read. */
    app: z.string().max(40),
    /** What is NOT in here, in words, so the file is honest without a screen. */
    excludes: z.array(z.string().max(60)),
    entries: z.array(backupEntrySchema),
  })
  .strict();

export type BackupFile = z.infer<typeof backupFileSchema>;

/**
 * Whether this app can read that file, and a sentence saying why not.
 *
 * A version check rather than a best effort. A newer file may carry entries
 * shaped in a way this app would silently drop, and dropping a farm's records
 * without saying so is the one outcome the whole feature exists to prevent.
 *
 * Older is fine in both directions that matter: `MIN_ACCEPTED` mirrors the
 * server's N−1 window (`sync/apply.ts`), and an older backup format is
 * something this app once wrote and still understands.
 */
export function backupRefusal(file: BackupFile): string | null {
  if (file.formatVersion > BACKUP_FORMAT_VERSION) {
    return `That backup was written by a newer version of ${PRODUCT_NAME}. Update the app and try again.`;
  }
  if (file.mutationSchemaVersion > MUTATION_SCHEMA_VERSION) {
    return 'That backup holds records this version cannot read. Update the app and try again.';
  }
  return null;
}
