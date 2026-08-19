import { beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_FORMAT_VERSION, MUTATION_SCHEMA_VERSION, newId } from '@homefarm/contracts';
import { backupFilename, buildBackup, serialiseBackup } from '@homefarm/core/backup/file';
import { planRestore, readBackup, runRestore } from '@homefarm/core/backup/restore';
import { enqueue } from '@homefarm/core/sync/queue';
import { localStore } from '@homefarm/core/db/store';
import { freshStore, readAllRecords } from '../support/store';
import { PRODUCT_NAME } from '@homefarm/contracts';

/**
 * A farm, out to a file and back again.
 *
 * The one route home for a farm that never made an account. `GET /snapshot`
 * covers every other case — a new phone, a reinstall, even a lapsed
 * subscription, because pull is deliberately ungated on billing — and leaves
 * exactly this one uncovered.
 *
 * What these assert is the property the whole thing rests on: **a restored
 * farm is the same farm, not a copy of it.** Every record keeps the ULID it
 * was minted with (D1), which is what makes the restore idempotent, makes a
 * resume the same act as a start, and means a farm that later signs up sends
 * its records rather than duplicates of them.
 */

const APP = '0.1.0-test';

/** A farm with a bit of everything the format has to survive. */
async function aFarm(): Promise<{ group: string; retired: string; machine: string }> {
  const group = newId();
  const retired = newId();
  const machine = newId();

  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: group,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });

  // Edited after creation: the backup must carry what it looks like now, not
  // the four mutations that got it there.
  await enqueue({ entity: 'flock', op: 'update', targetId: group, payload: { count: 9 } });

  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: retired,
    payload: { name: 'Last year’s meat birds', species: 'chicken', count: 20, purposes: ['meat'] },
  });
  await enqueue({ entity: 'flock', op: 'delete', targetId: retired, payload: {} });

  await enqueue({
    entity: 'equipment',
    op: 'create',
    targetId: machine,
    payload: { name: 'The tractor', make: 'Kubota', hasHourMeter: true },
  });

  for (const count of [11, 9, 12]) {
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      payload: { occurredAt: Date.now(), flockId: group, count },
    });
  }

  return { group, retired, machine };
}

beforeEach(async () => {
  await freshStore();
});

describe('what goes in the file', () => {
  it('carries every record the farm holds', async () => {
    await aFarm();
    const before = (await readAllRecords()).length;

    const { file, summary } = await buildBackup(newId(), APP);

    expect(summary.entries).toBe(before);
    expect(file.entries).toHaveLength(before);
  });

  it('carries the record as it is now, not the edits that shaped it', async () => {
    const { group } = await aFarm();

    const { file } = await buildBackup(newId(), APP);
    const flock = file.entries.filter((e) => e.targetId === group);

    expect(flock).toHaveLength(1);
    expect(flock[0]?.payload).toMatchObject({ name: 'The hens', count: 9 });
  });

  it('marks an archived record archived', async () => {
    const { retired } = await aFarm();

    const { file, summary } = await buildBackup(newId(), APP);

    expect(summary.archived).toBe(1);
    expect(file.entries.find((e) => e.targetId === retired)?.archived).toBe(true);
  });

  it('stamps the versions a reader has to check', async () => {
    await aFarm();
    const orgId = newId();

    const { file } = await buildBackup(orgId, APP);

    expect(file.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(file.mutationSchemaVersion).toBe(MUTATION_SCHEMA_VERSION);
    expect(file.orgId).toBe(orgId);
    expect(file.app).toBe(APP);
  });

  /** The file states its own limits, so it is honest without a screen. */
  it('says what is not in it', async () => {
    await aFarm();
    const { file } = await buildBackup(newId(), APP);
    expect(file.excludes).toContain('photographs');
  });

  it('names itself for the day it was written', () => {
    expect(backupFilename(Date.UTC(2026, 7, 7))).toBe(
      `${PRODUCT_NAME.toLowerCase()}-farm-2026-08-07.json`,
    );
  });
});

describe('out and back', () => {
  it('rebuilds the farm on an empty phone', async () => {
    await aFarm();
    const before = await readAllRecords();
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);

    await freshStore();
    expect(await readAllRecords()).toHaveLength(0);

    const read = readBackup(text);
    if (!read.ok) throw new Error(read.message);
    const plan = await planRestore(read.file, { signedIn: false });
    if (!plan.ok) throw new Error(plan.message);
    const result = await runRestore(plan);

    expect(result.refused).toBe(0);

    const after = await readAllRecords();
    expect(after).toHaveLength(before.length);

    // The same ids, not new ones. This is the whole property.
    expect(new Set(after.map((r) => r.key))).toEqual(new Set(before.map((r) => r.key)));
  });

  it('brings an archived record back archived', async () => {
    const { retired } = await aFarm();
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);

    await freshStore();
    await restoreFrom(text);

    const flocks = await localStore().readRecordsByEntity('flock');
    expect(flocks.find((r) => r.targetId === retired)?.deleted).toBe(true);
  });

  /**
   * The restored phone must not be told on its first morning that its records
   * exist nowhere else — the file they came out of is sitting in somebody's
   * email, and saying otherwise is the app arguing with what it just watched
   * happen.
   *
   * Dated when the file was written rather than now: the claim being recorded
   * is "a copy of these records exists, made then", and stamping today would
   * give a two-year-old backup a fresh ninety days.
   */
  it('counts the file it came from as this phone’s copy', async () => {
    await aFarm();
    const { file } = await buildBackup(newId(), APP);

    await freshStore();
    expect(await localStore().getLastBackupAt()).toBeNull();

    await restoreFrom(JSON.stringify(file));

    expect(await localStore().getLastBackupAt()).toBe(file.writtenAt);
  });

  /**
   * Nothing depends on the order today — `records` has no foreign keys and no
   * applier checks that a `flockId` names a flock — so this is removing a
   * class of bug rather than fixing one. The first applier to validate a
   * parent would otherwise break every restore retroactively.
   */
  it('writes parents before the records that name them', async () => {
    await aFarm();
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);

    await freshStore();
    const read = readBackup(text);
    if (!read.ok) throw new Error(read.message);
    const plan = await planRestore(read.file, { signedIn: false });
    if (!plan.ok) throw new Error(plan.message);

    const firstEgg = plan.toWrite.findIndex((e) => e.entity === 'eggLog');
    const lastFlock = plan.toWrite.map((e) => e.entity).lastIndexOf('flock');
    expect(lastFlock).toBeLessThan(firstEgg);

    const firstHours = plan.toWrite.findIndex((e) => e.entity === 'hourReading');
    if (firstHours !== -1) {
      expect(plan.toWrite.map((e) => e.entity).lastIndexOf('equipment')).toBeLessThan(firstHours);
    }
  });

  it('leaves everything queued, so a farm that later signs up sends it', async () => {
    await aFarm();
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);

    await freshStore();
    await restoreFrom(text);

    const queued = await localStore().readOutboxBySeq();
    expect(queued.length).toBeGreaterThan(0);
    expect(queued.every((m) => m.status === 'queued')).toBe(true);
  });
});

describe('putting the same file back twice', () => {
  it('changes nothing the second time', async () => {
    await aFarm();
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);

    await freshStore();
    await restoreFrom(text);
    const afterFirst = await readAllRecords();

    const read = readBackup(text);
    if (!read.ok) throw new Error(read.message);
    const second = await planRestore(read.file, { signedIn: false });
    if (!second.ok) throw new Error(second.message);

    expect(second.toWrite).toHaveLength(0);
    expect(second.alreadyThere).toBe(read.file.entries.length);
    expect(await readAllRecords()).toHaveLength(afterFirst.length);
  });

  /**
   * The restore was interrupted — the battery went, the app was killed.
   *
   * There is no flag anywhere saying one was in progress, and there must not
   * be: a flag has to survive the process death it exists to describe, and it
   * can disagree with the records. The records answer it by themselves.
   */
  it('finishes one that was interrupted', async () => {
    await aFarm();
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);
    const read = readBackup(text);
    if (!read.ok) throw new Error(read.message);

    await freshStore();

    // Half of it, then the lights go out.
    const first = await planRestore(read.file, { signedIn: false });
    if (!first.ok) throw new Error(first.message);
    const half = Math.floor(first.toWrite.length / 2);
    await runRestore({ ...first, toWrite: first.toWrite.slice(0, half) });

    const resumed = await planRestore(read.file, { signedIn: false });
    if (!resumed.ok) throw new Error(resumed.message);

    expect(resumed.alreadyThere).toBe(half);
    expect(resumed.toWrite).toHaveLength(read.file.entries.length - half);

    await runRestore(resumed);
    expect(await readAllRecords()).toHaveLength(read.file.entries.length);
  });
});

describe('what it refuses', () => {
  it('refuses a phone that already keeps its own records', async () => {
    await aFarm();
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);

    // A different farm entirely — one record is enough.
    await freshStore();
    await enqueue({
      entity: 'flock',
      op: 'create',
      payload: { name: 'Somebody else’s goats', species: 'goat', count: 3, purposes: ['milk'] },
    });

    const read = readBackup(text);
    if (!read.ok) throw new Error(read.message);
    const plan = await planRestore(read.file, { signedIn: false });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toContain('already keeps records of its own');
  });

  /**
   * Checked across every entity, not only the ones the file mentions.
   *
   * A backup with no machines going onto a handset with three machines on it
   * is still two farms being mixed, and looking only at the entities in the
   * file would let it through — which is the quiet version of the exact
   * corruption this refuses to do.
   */
  it('refuses over a record of a kind the backup does not mention', async () => {
    await enqueue({
      entity: 'flock',
      op: 'create',
      payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
    });
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);

    await freshStore();
    await enqueue({
      entity: 'equipment',
      op: 'create',
      payload: { name: 'A tractor this backup has never heard of', hasHourMeter: false },
    });

    const read = readBackup(text);
    if (!read.ok) throw new Error(read.message);
    expect((await planRestore(read.file, { signedIn: false })).ok).toBe(false);
  });

  /**
   * Not a nicety — it is the one refusal with a tenancy consequence.
   *
   * A signed-in device's queue flushes under the org in its token (invariant
   * 2), so restoring a file into a farm somebody is signed in to would push
   * one farm's records at another farm's server. And a handset that has just
   * signed in and not yet pulled has an empty store, so the emptiness rule
   * would have let it straight through.
   */
  it('refuses a phone that is signed in', async () => {
    await aFarm();
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);

    await freshStore();
    const read = readBackup(text);
    if (!read.ok) throw new Error(read.message);

    const plan = await planRestore(read.file, { signedIn: true });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toContain('signed in');
    expect(await readAllRecords()).toHaveLength(0);
  });

  it('refuses something that is not a backup', () => {
    expect(readBackup('not json at all').ok).toBe(false);
    expect(readBackup('{"hello":"world"}').ok).toBe(false);
    expect(readBackup('[]').ok).toBe(false);
  });

  /** An unknown key is a file this app did not write, or one from a version that knows more. */
  it('refuses a file with a key it does not recognise', async () => {
    await aFarm();
    const { file } = await buildBackup(newId(), APP);
    const text = JSON.stringify({ ...file, somethingElse: true });

    expect(readBackup(text).ok).toBe(false);
  });

  /**
   * Newer is refused rather than read as best it can be.
   *
   * A newer file may carry entries shaped in a way this app would silently
   * drop, and dropping a farm's records without saying so is the one outcome
   * the whole feature exists to prevent.
   */
  it('refuses a file from a newer app, and says which', async () => {
    await aFarm();
    const { file } = await buildBackup(newId(), APP);

    const newerFormat = readBackup(
      JSON.stringify({ ...file, formatVersion: BACKUP_FORMAT_VERSION + 1 }),
    );
    expect(newerFormat.ok).toBe(false);
    if (!newerFormat.ok) expect(newerFormat.message).toContain('newer version');

    const newerRecords = readBackup(
      JSON.stringify({ ...file, mutationSchemaVersion: MUTATION_SCHEMA_VERSION + 1 }),
    );
    expect(newerRecords.ok).toBe(false);
    if (!newerRecords.ok) expect(newerRecords.message).toContain('cannot read');
  });

  /**
   * A hand-edited record is dropped, counted, and the rest still lands.
   *
   * Every entry goes through `enqueue`, which parses it against the same
   * schema the server would — so a file somebody opened in a text editor
   * cannot put a shape into the store that the app could not have made.
   */
  it('drops a record it cannot read without losing the others', async () => {
    await aFarm();
    const { file } = await buildBackup(newId(), APP);

    const damaged = {
      ...file,
      entries: file.entries.map((e, i) => (i === 0 ? { ...e, payload: { nonsense: true } } : e)),
    };

    await freshStore();
    const read = readBackup(JSON.stringify(damaged));
    if (!read.ok) throw new Error(read.message);
    const plan = await planRestore(read.file, { signedIn: false });
    if (!plan.ok) throw new Error(plan.message);

    const result = await runRestore(plan);

    expect(result.refused).toBe(1);
    expect(result.firstRefusal).not.toBeNull();
    expect(result.written).toBe(file.entries.length - 1);

    /**
     * Named, not counted. "1 record could not be read" is a wound with no
     * handle — it tells somebody mid-recovery that something is permanently
     * gone and gives them nothing to do about it. A group's own name is a
     * fact they can act on, usually by typing it back in.
     */
    expect(result.lost).toHaveLength(1);
    expect(result.lost[0]).toContain(damaged.entries[0]!.entity);
  });
});

describe('while it runs', () => {
  it('reports how far it has got', async () => {
    await aFarm();
    const text = serialiseBackup((await buildBackup(newId(), APP)).file);

    await freshStore();
    const read = readBackup(text);
    if (!read.ok) throw new Error(read.message);
    const plan = await planRestore(read.file, { signedIn: false });
    if (!plan.ok) throw new Error(plan.message);

    const seen: number[] = [];
    await runRestore(plan, ({ done, total }) => {
      expect(total).toBe(plan.toWrite.length);
      seen.push(done);
    });

    expect(seen).toEqual(plan.toWrite.map((_, i) => i + 1));
  });
});

async function restoreFrom(text: string): Promise<void> {
  const read = readBackup(text);
  if (!read.ok) throw new Error(read.message);
  const plan = await planRestore(read.file, { signedIn: false });
  if (!plan.ok) throw new Error(plan.message);
  await runRestore(plan);
}

describe('naming what was lost', () => {
  it('says which records could not be read, and stops before it is a wall', async () => {
    const { group } = await aFarm();
    // Comfortably past the cap, so the truncation is actually exercised.
    for (let i = 0; i < 12; i += 1) {
      await enqueue({
        entity: 'eggLog',
        op: 'create',
        payload: { occurredAt: Date.now() - i * 3_600_000, flockId: group, count: 6 },
      });
    }
    const { file } = await buildBackup(newId(), APP);

    // Every entry damaged: a file corrupted in the middle can do this, and a
    // screen listing nine hundred names is a screen nobody reads.
    const damaged = {
      ...file,
      entries: file.entries.map((e) => ({ ...e, payload: { nonsense: true } })),
    };

    await freshStore();
    const read = readBackup(JSON.stringify(damaged));
    if (!read.ok) throw new Error(read.message);
    const plan = await planRestore(read.file, { signedIn: false });
    if (!plan.ok) throw new Error(plan.message);

    const result = await runRestore(plan);

    expect(result.written).toBe(0);
    expect(result.refused).toBe(file.entries.length);
    expect(result.lost.length).toBeLessThanOrEqual(6);
    expect(result.lost.length).toBeLessThan(result.refused);
  });

  /** A record with no human handle is named by its kind, which still beats a bare count. */
  it('falls back to the kind when a record has no name', async () => {
    await aFarm();
    const { file } = await buildBackup(newId(), APP);
    const egg = file.entries.find((e) => e.entity === 'eggLog');
    if (egg === undefined) throw new Error('no egg log');

    const damaged = {
      ...file,
      entries: [{ ...egg, payload: { nonsense: true } }],
    };

    await freshStore();
    const read = readBackup(JSON.stringify(damaged));
    if (!read.ok) throw new Error(read.message);
    const plan = await planRestore(read.file, { signedIn: false });
    if (!plan.ok) throw new Error(plan.message);

    expect((await runRestore(plan)).lost).toEqual(['eggLog']);
  });
});

/**
 * A restored photo asks for its bytes again.
 *
 * `BACKUP_EXCLUDES` keeps the images out of the file on purpose, and
 * `buildBackup` walks every entity, so the photo's record goes in carrying the
 * projection's `uploadedAt`. Restored onto a rebuilt server that is a claim
 * about bytes nothing holds: the transfer loop offers a photo only when
 * `uploadedAt` is absent, so the device still holding the file never offers it
 * and every download answers 404 — a gallery of records with no pictures in it.
 */
describe('photographs, which the file does not carry', () => {
  async function aPhotographedFarm(): Promise<string> {
    const subject = newId();
    const photo = newId();

    await enqueue({
      entity: 'flock',
      op: 'create',
      targetId: subject,
      payload: { name: 'The hens', species: 'chicken', count: 6 },
    });
    await enqueue({
      entity: 'photo',
      op: 'create',
      targetId: photo,
      payload: {
        subjectId: subject,
        contentType: 'image/jpeg',
        byteSize: 240_000,
        capturedAt: Date.now(),
      },
    });
    // The stamp the transfer loop writes once the server has the bytes.
    await enqueue({
      entity: 'photo',
      op: 'update',
      targetId: photo,
      payload: { uploadedAt: Date.now() },
    });

    return photo;
  }

  it('drops the upload stamp, so the bytes are offered again', async () => {
    const photo = await aPhotographedFarm();
    const { file } = await buildBackup(newId(), APP);

    // The record in the file still says the server has them — that is the
    // projection's honest current value, and it is what makes the restore the
    // place to deal with it.
    const entry = file.entries.find((e) => e.targetId === photo);
    expect(entry?.payload).toHaveProperty('uploadedAt');

    await freshStore();
    const read = readBackup(JSON.stringify(file));
    if (!read.ok) throw new Error(read.message);
    const plan = await planRestore(read.file, { signedIn: false });
    if (!plan.ok) throw new Error(plan.message);
    await runRestore(plan);

    const records = await readAllRecords();
    const restored = records.find((r) => r.targetId === photo);

    expect(restored).toBeDefined();
    expect(restored?.value).not.toHaveProperty('uploadedAt');
  });

  it('keeps everything else about the photo', async () => {
    const photo = await aPhotographedFarm();
    const { file } = await buildBackup(newId(), APP);

    await freshStore();
    const read = readBackup(JSON.stringify(file));
    if (!read.ok) throw new Error(read.message);
    const plan = await planRestore(read.file, { signedIn: false });
    if (!plan.ok) throw new Error(plan.message);
    await runRestore(plan);

    const restored = (await readAllRecords()).find((r) => r.targetId === photo);
    expect(restored?.value).toMatchObject({ contentType: 'image/jpeg', byteSize: 240_000 });
  });

  /** Every other entity is restored exactly as it was — this is one field, not a rule. */
  it('leaves other entities untouched', async () => {
    await aFarm();
    const { file } = await buildBackup(newId(), APP);

    await freshStore();
    const read = readBackup(JSON.stringify(file));
    if (!read.ok) throw new Error(read.message);
    const plan = await planRestore(read.file, { signedIn: false });
    if (!plan.ok) throw new Error(plan.message);
    await runRestore(plan);

    const records = await readAllRecords();
    for (const entry of file.entries.filter((e) => e.entity !== 'photo')) {
      const restored = records.find((r) => r.targetId === entry.targetId);
      expect(restored?.value).toEqual(entry.payload);
    }
  });
});
