import { beforeEach, describe, expect, it } from 'vitest';
import { files } from '../support/native/modules';
import { readLook, writeLook } from '../../apps/mobile/src/theme/look';

/**
 * The look this handset was told to wear, across restarts.
 *
 * Reported from the phone: *"I selected lamplight and shut the app down and
 * when I loaded the app again it was back on follow the device."*
 *
 * `ThemeProvider` had said the override was session-scoped and that persisting
 * one *"belongs with the SQLite settings table"* — so the behaviour was known
 * and the other half was never built. What is asserted here is the half that
 * was missing, and specifically the case the three-way return exists for: a
 * stored "follow the device" is an answer somebody gave, not a missing value.
 */

const PATH = 'file:///documents/device.json';

beforeEach(() => {
  files.clear();
});

describe('a handset that has never been asked', () => {
  it('has no answer, rather than a wrong one', async () => {
    expect(await readLook()).toBeUndefined();
  });
});

describe('a look that was chosen', () => {
  it('is there on the next launch', async () => {
    await writeLook('lamplight');

    expect(await readLook()).toBe('lamplight');
  });

  it('keeps bright sun, which is a legibility choice and not a time of day', async () => {
    await writeLook('sun');

    expect(await readLook()).toBe('sun');
  });

  it('replaces the last one rather than stacking', async () => {
    await writeLook('lamplight');
    await writeLook('daylight');

    expect(await readLook()).toBe('daylight');
  });

  /**
   * The case the whole three-way return is for.
   *
   * "Follow the device" is one of the three rows the setting offers, so it is a
   * decision. Storing it as an absence would mean somebody who chose it after
   * choosing lamplight got lamplight back on the next launch — the reported bug
   * again, arriving from the opposite direction and much harder to spot.
   */
  it('remembers being told to follow the device', async () => {
    await writeLook('lamplight');
    await writeLook(null);

    expect(await readLook()).toBeNull();
  });
});

describe('a file that cannot be trusted', () => {
  it('ignores a theme this version has never heard of', async () => {
    files.set(PATH, JSON.stringify({ look: 'moonlight' }));

    // Undefined, not null: nothing was chosen that this app can honour, so the
    // system decides. Null would claim somebody asked to follow the device.
    expect(await readLook()).toBeUndefined();
  });

  it('ignores a file that is not JSON at all', async () => {
    files.set(PATH, 'half a write, then the battery went');

    expect(await readLook()).toBeUndefined();
  });

  it('ignores a look that is not a string', async () => {
    files.set(PATH, JSON.stringify({ look: 7 }));

    expect(await readLook()).toBeUndefined();
  });

  /** A preference is never worth a crash on a cold start. */
  it('survives a file with the wrong shape entirely', async () => {
    files.set(PATH, JSON.stringify(['lamplight']));

    expect(await readLook()).toBeUndefined();
  });
});
