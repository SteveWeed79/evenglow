import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { buildBackup, serialiseBackup } from '@steading/core/backup/file';
import { planRestore, readBackup, runRestore } from '@steading/core/backup/restore';
import { EXPOSED_AT } from '@steading/core/backup/exposure';
import { localStore } from '@steading/core/db/store';
import { enqueue } from '@steading/core/sync/queue';
import { files, picker, seedSecureStore, shared } from '../support/native/modules';
import { freshStore, readAllRecords } from '../support/store';
import { mount } from '../support/screen';
import { navCalls, resetNav } from '../support/native/navigation';
import { resetTrouble } from '../../apps/mobile/src/hooks/useTrouble';
import { BackupScreen } from '../../apps/mobile/src/screens/BackupScreen';
import { ExposureNotice } from '../../apps/mobile/src/components/ExposureNotice';
import { SettingsScreen } from '../../apps/mobile/src/screens/SettingsScreen';

/**
 * The copy a farm can carry, from the screen.
 *
 * What is asserted here is what the modules underneath cannot see: that the
 * screen shows the half that can do something, that a file actually reached
 * the share sheet rather than the screen quietly succeeding, and that the
 * notice on Today goes away when somebody acts rather than when they agree to
 * stop being told.
 */

const PICKED = 'file:///cache/picked.json';

/**
 * What a person reads, with the harness's seams closed up.
 *
 * `text()` joins every string node with a space, so a line built as
 * `{count} records` arrives as "200  records". That is an artefact of walking
 * the tree rather than anything on the screen, and an assertion written around
 * it would be pinned to the harness instead of to the copy.
 */
function reads(screen: { text: () => string }): string {
  return screen.text().replace(/\s+/g, ' ');
}

async function aFarm(records = 6): Promise<void> {
  const flock = newId();
  await enqueue({
    entity: 'flock',
    op: 'create',
    targetId: flock,
    payload: { name: 'The hens', species: 'chicken', count: 6, purposes: ['eggs'] },
  });
  for (let i = 1; i < records; i += 1) {
    await enqueue({
      entity: 'eggLog',
      op: 'create',
      payload: { occurredAt: Date.now() - i * 3_600_000, flockId: flock, count: 6 },
    });
  }
}

/** A backup file of the current farm, parked where the picker will hand it back. */
async function fileOnThePhone(): Promise<string> {
  const text = serialiseBackup((await buildBackup(newId(), '0.1.0-test')).file);
  files.set(PICKED, text);
  picker.next = PICKED;
  return text;
}

beforeEach(async () => {
  await freshStore();
  resetTrouble();
  files.clear();
  shared.length = 0;
  picker.next = null;
  seedSecureStore({});
  resetNav();
});

describe('taking a copy', () => {
  it('offers to make one on a farm with records', async () => {
    await aFarm();
    const screen = await mount(<BackupScreen />);

    expect(screen.has('backup-take')).toBe(true);
    screen.unmount();
  });

  it('writes a file and offers it to the OS', async () => {
    await aFarm();
    const screen = await mount(<BackupScreen />);

    await screen.press('backup-take');

    expect(shared).toHaveLength(1);
    const written = files.get(shared[0] ?? '');
    expect(written).toBeDefined();
    expect(JSON.parse(written ?? '{}')).toMatchObject({ format: 'steading.farm-records' });
    screen.unmount();
  });

  /**
   * Stamped when the file is written, not when the share sheet closes.
   *
   * The sheet does not report which app took the file or whether it kept it,
   * so waiting for a result that never arrives would leave a farm that shared
   * a backup to itself still being told its records are in one place.
   */
  it('remembers that a copy was taken', async () => {
    await aFarm();
    expect(await localStore().getLastBackupAt()).toBeNull();

    const screen = await mount(<BackupScreen />);
    await screen.press('backup-take');

    expect(await localStore().getLastBackupAt()).not.toBeNull();
    screen.unmount();
  });

  it('says how many records went in', async () => {
    await aFarm(9);
    const screen = await mount(<BackupScreen />);

    await screen.press('backup-take');

    expect(reads(screen)).toContain('9 records copied');
    screen.unmount();
  });

  /**
   * Said after the button and not instead of it.
   *
   * Somebody who opened this screen wants the file. What they must not leave
   * without knowing is that a file holds a moment and an account keeps itself
   * up to date.
   */
  it('still says an account is the better answer', async () => {
    await aFarm();
    const screen = await mount(<BackupScreen />);

    expect(screen.text()).toContain('An account keeps the copy up to date');
    expect(screen.has('backup-account')).toBe(true);
    screen.unmount();
  });
});

describe('putting one back', () => {
  it('offers to on a farm with nothing logged', async () => {
    const screen = await mount(<BackupScreen />);

    expect(screen.has('backup-choose')).toBe(true);
    // Nothing to copy, so nothing offers to copy it.
    expect(screen.has('backup-take')).toBe(false);
    screen.unmount();
  });

  /**
   * Reachable on a farm with records, and this is a correction.
   *
   * The two halves used to be an either/or on `records === 0`, which read
   * tidily and meant that a restore interrupted by a flat battery could never
   * be finished: the records it had written switched the screen to the copy
   * half, and the file picker was gone. The resume the engine was built around
   * was unreachable from the app.
   */
  it('is still offered when the phone has records, so an interrupted one can finish', async () => {
    await aFarm(6);
    const screen = await mount(<BackupScreen />);

    expect(screen.has('backup-choose')).toBe(true);
    screen.unmount();
  });

  it('finishes a restore that was interrupted', async () => {
    await aFarm(8);
    const whole = (await readAllRecords()).length;
    const text = await fileOnThePhone();

    // Half of it lands, then the lights go out.
    await freshStore();
    const read = readBackup(text);
    if (!read.ok) throw new Error(read.message);
    const first = await planRestore(read.file, { signedIn: false });
    if (!first.ok) throw new Error(first.message);
    const half = Math.floor(first.toWrite.length / 2);
    await runRestore({ ...first, toWrite: first.toWrite.slice(0, half) });

    files.set(PICKED, text);
    picker.next = PICKED;

    const screen = await mount(<BackupScreen />);
    await screen.press('backup-choose');
    expect(reads(screen)).toContain(`${half} are already here`);

    await screen.press('backup-put');
    await screen.press('backup-put');

    expect(await readAllRecords()).toHaveLength(whole);
    screen.unmount();
  });

  it('says so when everything in the file is already back', async () => {
    await aFarm(6);
    const text = await fileOnThePhone();

    await freshStore();
    await restoreEverything(text);

    files.set(PICKED, text);
    picker.next = PICKED;

    const screen = await mount(<BackupScreen />);
    await screen.press('backup-choose');

    expect(reads(screen)).toContain('already on this phone');
    expect(screen.has('backup-put')).toBe(false);
    screen.unmount();
  });

  it('points at signing in first, because it is better', async () => {
    const screen = await mount(<BackupScreen />);
    expect(screen.text()).toContain('signing in is better');
    screen.unmount();
  });

  it('says what would happen before anything happens', async () => {
    await aFarm(6);
    const before = (await readAllRecords()).length;
    await fileOnThePhone();

    await freshStore();
    const screen = await mount(<BackupScreen />);
    await screen.press('backup-choose');

    expect(reads(screen)).toContain(`${before} records from that file`);
    // Nothing written yet — this is the plan, not the restore.
    expect(await readAllRecords()).toHaveLength(0);
    screen.unmount();
  });

  it('puts them back on the second tap, not the first', async () => {
    await aFarm(6);
    const before = (await readAllRecords()).length;
    await fileOnThePhone();

    await freshStore();
    const screen = await mount(<BackupScreen />);
    await screen.press('backup-choose');

    // `Confirm` — one tap arms, the second acts.
    await screen.press('backup-put');
    expect(await readAllRecords()).toHaveLength(0);

    await screen.press('backup-put');
    expect(await readAllRecords()).toHaveLength(before);
    expect(reads(screen)).toContain(`${before} records are back`);
    screen.unmount();
  });

  it('says nothing was picked when the picker is backed out of', async () => {
    picker.next = null;
    const screen = await mount(<BackupScreen />);

    await screen.press('backup-choose');

    // Backing out is a decision, not a failure: no message, nothing changed.
    expect(screen.has('backup-put')).toBe(false);
    expect(screen.text()).not.toContain('could not');
    screen.unmount();
  });

  it('refuses a file that is not a backup, in one sentence', async () => {
    files.set(PICKED, 'this is a photo, not a backup');
    picker.next = PICKED;

    const screen = await mount(<BackupScreen />);
    await screen.press('backup-choose');

    expect(screen.text()).toContain('not a Steading backup');
    expect(screen.has('backup-put')).toBe(false);
    screen.unmount();
  });

  /** One record the file has never heard of is enough. */
  it('refuses a phone that keeps a different farm', async () => {
    await aFarm(6);
    const text = await fileOnThePhone();

    await freshStore();
    await aFarm(6); // Same shape, different ids — a different farm.
    files.set(PICKED, text);
    picker.next = PICKED;

    const screen = await mount(<BackupScreen />);
    await screen.press('backup-choose');

    expect(reads(screen)).toContain('already keeps records of its own');
    expect(screen.has('backup-put')).toBe(false);
    screen.unmount();
  });
});

describe('the notice on Today', () => {
  it('says nothing on a new farm', async () => {
    await aFarm(6);
    const screen = await mount(<ExposureNotice />);

    expect(screen.has('exposure-notice')).toBe(false);
    screen.unmount();
  });

  it('speaks once there is a season to lose, and counts', async () => {
    await aFarm(EXPOSED_AT);
    const screen = await mount(<ExposureNotice />);

    expect(screen.has('exposure-notice')).toBe(true);
    expect(reads(screen)).toContain(`${EXPOSED_AT} records, on this phone only`);
    screen.unmount();
  });

  it('goes to the copy rather than to the account', async () => {
    await aFarm(EXPOSED_AT);
    const screen = await mount(<ExposureNotice />);

    await screen.press('exposure-notice');

    expect(navCalls().at(-1)).toMatchObject({ action: 'navigate', route: 'Backup' });
    screen.unmount();
  });

  /**
   * It ends when somebody acts, not when they agree to stop being told.
   *
   * `WeatherWarnings` sets out why a dismiss button is the wrong answer: a
   * stored "I saw this" is a completion flag that drifts from what it
   * describes, and the reflex it trains gets spent on the row that mattered.
   * There is nothing to dismiss here, and this is why that is affordable.
   */
  it('goes quiet after a copy is taken', async () => {
    await aFarm(EXPOSED_AT);
    await localStore().setLastBackupAt(Date.now());

    const screen = await mount(<ExposureNotice />);
    expect(screen.has('exposure-notice')).toBe(false);
    screen.unmount();
  });

  it('goes quiet once anything has reached a server', async () => {
    await aFarm(EXPOSED_AT);
    await localStore().markSynced(Date.now());

    const screen = await mount(<ExposureNotice />);
    expect(screen.has('exposure-notice')).toBe(false);
    screen.unmount();
  });
});

describe('the Settings row', () => {
  /**
   * "Everything is on this phone only" is true on day one about four records
   * and in year two about two thousand, so it said the same thing whether or
   * not it mattered. A number is a fact somebody can weigh.
   */
  it('counts, rather than saying everything', async () => {
    await aFarm(37);
    const screen = await mount(<SettingsScreen onSignedOut={() => undefined} />);

    expect(reads(screen)).toContain('37 records on this phone only');
    screen.unmount();
  });

  it('offers the copy beside the spreadsheets', async () => {
    await aFarm(6);
    const screen = await mount(<SettingsScreen onSignedOut={() => undefined} />);

    expect(screen.has('go-backup')).toBe(true);
    expect(screen.has('go-export')).toBe(true);
    screen.unmount();
  });

  /**
   * The two rows sit one above the other and "export" is the word most people
   * already attach to backing up. Without this line somebody frightened about
   * a failing phone sends themselves thirteen spreadsheets, believes they are
   * covered, and finds out otherwise on the worst possible day.
   */
  it('says the spreadsheets cannot be put back', async () => {
    await aFarm(6);
    const screen = await mount(<SettingsScreen onSignedOut={() => undefined} />);

    expect(reads(screen)).toContain('cannot be put back');
    screen.unmount();
  });

  /**
   * The date is the one fact that makes a wrong answer discoverable. Taking a
   * copy stamps it when the file is written, and the share sheet never reports
   * whether anything took the file — so somebody who opened the sheet and
   * backed out has bought silence they did not earn, and being able to see
   * what the app thinks happened is the only defence against it.
   */
  it('shows when the last copy was taken', async () => {
    await aFarm(6);
    const before = await mount(<SettingsScreen onSignedOut={() => undefined} />);
    expect(reads(before)).toContain('none taken yet');
    before.unmount();

    await localStore().setLastBackupAt(Date.UTC(2026, 7, 7, 12));

    const after = await mount(<SettingsScreen onSignedOut={() => undefined} />);
    expect(reads(after)).toContain('Last taken');
    expect(reads(after)).toContain('2026');
    after.unmount();
  });

  it('offers to put one back on an empty farm', async () => {
    const screen = await mount(<SettingsScreen onSignedOut={() => undefined} />);

    expect(screen.text()).toContain('Put a backup from another phone');
    screen.unmount();
  });
});

/** Puts a whole file back, without going through the screen. */
async function restoreEverything(text: string): Promise<void> {
  const read = readBackup(text);
  if (!read.ok) throw new Error(read.message);
  const plan = await planRestore(read.file, { signedIn: false });
  if (!plan.ok) throw new Error(plan.message);
  await runRestore(plan);
}
