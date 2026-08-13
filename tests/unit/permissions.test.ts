import { describe, expect, it } from 'vitest';
import appJson from '../../apps/mobile/app.json';

/**
 * What the manifest asks a farm for.
 *
 * ## The one permission this app wants, and the one it does not
 *
 * `weather/where.ts` asks for `Accuracy.Low` — about a kilometre — and then
 * calls `roundPosition` before the value goes anywhere. The permission string
 * in `app.json` promises exactly that out loud: *"stored rounded to about a
 * kilometre and never sent anywhere but the weather service"*.
 *
 * `ACCESS_FINE_LOCATION` is precise GPS. Nothing here reads it, nothing here
 * stores it, and asking for it would make that sentence untrue at the moment
 * somebody is deciding whether to believe it.
 *
 * ## Why this is asserted rather than left to app.json
 *
 * **It was added by a tool, not by a person.** `eas init` normalises the config
 * on its way past, and materialising what the `expo-location` plugin implies
 * wrote both permissions into the file — in the same commit as the project id,
 * where it read like part of the linking. A build made from it would have
 * shipped precise location to a tester's phone.
 *
 * Nothing stops that happening again the next time a tool rewrites this file,
 * so the rule lives here instead of in a comment nobody re-reads.
 *
 * `blockedPermissions` rather than simply omitting it: a config plugin adds
 * what it wants at prebuild regardless of what the list above says, and
 * blocking is the only thing that takes it back out.
 */

const android = appJson.expo.android as {
  permissions?: string[];
  blockedPermissions?: string[];
};

const FINE = 'android.permission.ACCESS_FINE_LOCATION';
const COARSE = 'android.permission.ACCESS_COARSE_LOCATION';

describe('what the Android manifest asks for', () => {
  it('asks for approximate location, which is all the weather needs', () => {
    expect(android.permissions).toContain(COARSE);
  });

  /**
   * The failure this exists for. A plugin adds it, a tool writes it down, and
   * nobody notices until Play asks why an egg-logging app wants precise GPS.
   */
  it('never asks for precise location', () => {
    expect(android.permissions ?? []).not.toContain(FINE);
    expect(android.blockedPermissions ?? []).toContain(FINE);
  });

  /**
   * Blocking something also listed is a config that disagrees with itself, and
   * which half wins is a detail of prebuild nobody should have to know.
   */
  it('does not both ask for and block the same permission', () => {
    const asked = new Set(android.permissions ?? []);
    for (const blocked of android.blockedPermissions ?? []) {
      expect(asked.has(blocked), `${blocked} is both asked for and blocked`).toBe(false);
    }
  });

  /**
   * Camera and photos are asked for by `expo-image-picker` at the moment they
   * are used, so they are deliberately not declared here. This pins the list to
   * what has been thought about — a new entry appearing means a tool wrote it,
   * which is exactly how the fine-location one arrived.
   */
  it('declares nothing else, so an addition has to be deliberate', () => {
    expect(android.permissions).toEqual([COARSE]);
  });
});
