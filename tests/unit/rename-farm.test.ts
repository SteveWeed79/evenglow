import { beforeEach, describe, expect, it } from 'vitest';
import { canInvite, canRenameFarm, farmNameSchema, renameFarmSchema } from '@homefarm/contracts';
import { seedSecureStore } from '../support/native/modules';
import { claimsSnapshot, readCachedClaims, subscribeToClaims } from '../../apps/mobile/src/auth/store';
import { rememberFarmName } from '../../apps/mobile/src/auth/session';

/**
 * Renaming the farm.
 *
 * A farm name is typed once, during signup, by somebody doing four other things
 * at the same time — and then shown on every screen forever. There was no way
 * to change it. Reported as the question nobody had thought to ask: *"what
 * happens if they get a partner, divorced, drunk when they start the farm in
 * the app and misspell it?"*
 *
 * All three are the same case. Names change.
 */

describe('who may', () => {
  /**
   * The same bar as inviting, and the reasoning is that a manager already holds
   * the larger power. Somebody trusted to bring people onto the farm and take
   * them off it is not somebody who needs protecting from a spelling.
   */
  it('lets an owner and a manager', () => {
    expect(canRenameFarm('owner')).toBe(true);
    expect(canRenameFarm('admin')).toBe(true);
  });

  it('does not let a hand', () => {
    expect(canRenameFarm('hand')).toBe(false);
  });

  it('draws the same line as inviting, deliberately', () => {
    for (const role of ['owner', 'admin', 'hand'] as const) {
      expect(canRenameFarm(role), role).toBe(canInvite(role));
    }
  });
});

describe('the name itself', () => {
  it('takes an ordinary one', () => {
    expect(renameFarmSchema.parse({ name: 'Hollow Farm' })).toEqual({ name: 'Hollow Farm' });
  });

  /**
   * Trimmed before it is judged, so a name of four spaces is refused rather
   * than stored as a farm called nothing — which would render as an empty
   * heading on every screen with no way to tell it from a bug.
   */
  it('refuses a name that is only spaces', () => {
    expect(renameFarmSchema.safeParse({ name: '    ' }).success).toBe(false);
  });

  it('refuses an empty one', () => {
    expect(farmNameSchema.safeParse('').success).toBe(false);
  });

  it('trims the edges rather than keeping them', () => {
    expect(renameFarmSchema.parse({ name: '  Hollow Farm  ' })).toEqual({ name: 'Hollow Farm' });
  });

  it('refuses something longer than a name', () => {
    expect(farmNameSchema.safeParse('x'.repeat(121)).success).toBe(false);
    expect(farmNameSchema.safeParse('x'.repeat(120)).success).toBe(true);
  });

  /** Farms are called things with apostrophes and accents in them. */
  it('takes a name with punctuation in it', () => {
    for (const name of ["O'Brien's", 'Ferme de l’Étang', 'Hill & Dale', 'Nº 4 Smallholding']) {
      expect(farmNameSchema.safeParse(name).success, name).toBe(true);
    }
  });

  /** Strict, so a payload carrying an orgId cannot smuggle one past the route
      that reads the org from the verified token instead (invariant 2). */
  it('refuses anything else in the payload', () => {
    expect(
      renameFarmSchema.safeParse({ name: 'Hollow Farm', orgId: '01J00000000000000000000000' })
        .success,
    ).toBe(false);
  });
});

/**
 * The half that makes the app answer.
 *
 * The server owns the name; the **cached claims** are what every screen reads —
 * `useFarmName`, the Settings row, the Today subtitle. Writing them publishes,
 * so the same subscription that made signing out visible carries a rename too.
 * That is the return on having moved the notification into `store.ts` rather
 * than poking screens by hand.
 */
describe('remembering it on this device', () => {
  const CLAIMS = {
    userId: 'u1',
    orgId: '01J0000000000000000000000A',
    role: 'owner' as const,
    orgName: 'Holow Farm',
  };

  beforeEach(() => {
    seedSecureStore({ 'homefarm.claims': JSON.stringify(CLAIMS) });
  });

  it('replaces the name and tells everything watching', async () => {
    // Settle the snapshot first, the way a mounted screen would have.
    await readCachedClaims();

    let told = 0;
    const stop = subscribeToClaims(() => {
      told += 1;
    });

    await rememberFarmName('Hollow Farm');

    expect(claimsSnapshot()?.orgName).toBe('Hollow Farm');
    expect(told).toBeGreaterThan(0);

    stop();
  });

  it('keeps everything else about the session', async () => {
    await rememberFarmName('Hollow Farm');

    expect(claimsSnapshot()).toMatchObject({ userId: 'u1', role: 'owner' });
  });

  it('trims what it stores', async () => {
    await rememberFarmName('  Hollow Farm  ');

    expect(claimsSnapshot()?.orgName).toBe('Hollow Farm');
  });

  /**
   * A device with no session has no farm name to hold, and inventing a claims
   * record here would be the cache asserting a session that does not exist.
   */
  it('does nothing on a device that is not signed in', async () => {
    seedSecureStore({});
    await readCachedClaims();

    await rememberFarmName('Hollow Farm');

    expect(claimsSnapshot()).toBeNull();
  });
});
