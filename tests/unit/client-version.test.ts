import { describe, expect, it } from 'vitest';
import {
  CLIENT_VERSION_HEADER,
  isClientTooOld,
  parseVersion,
  syncRefusalMessage,
} from '@steading/contracts';

/**
 * How old is too old, and the two ways this must not go wrong.
 *
 * `[23]` and `[24]`. A sideloaded install has no updater, so a farm gets a fix
 * when somebody tells it to go and get one — and the wire has widened its
 * entity list before and now has a `null` that means *clear this field*. A
 * build old enough to misread either disagrees with the farm's other devices
 * silently, which is the failure this converts into a sentence.
 *
 * The two ways it goes wrong are opposite and both are worse than the bug:
 * refusing a farm that is fine, and locking one out over a mistyped setting.
 */

describe('reading a version', () => {
  it('takes the shape app.json produces and nothing else', () => {
    expect(parseVersion('0.1.18')).toEqual({ major: 0, minor: 1, patch: 18 });
    expect(parseVersion(' 1.2.3 ')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('refuses anything that is not three numbers', () => {
    expect(parseVersion('0.1')).toBeNull();
    expect(parseVersion('0.1.18-beta')).toBeNull();
    expect(parseVersion('v0.1.18')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('the floor', () => {
  /** Every server today, and the state one stays in until somebody decides. */
  it('refuses nobody when there is no floor', () => {
    expect(isClientTooOld('0.0.1', null)).toBe(false);
    expect(isClientTooOld(undefined, null)).toBe(false);
  });

  it('lets the floor itself through', () => {
    expect(isClientTooOld('0.1.18', '0.1.18')).toBe(false);
  });

  it('refuses what is below it, on each part in turn', () => {
    expect(isClientTooOld('0.1.17', '0.1.18')).toBe(true);
    expect(isClientTooOld('0.0.99', '0.1.0')).toBe(true);
    expect(isClientTooOld('1.9.9', '2.0.0')).toBe(true);
  });

  it('lets anything above it through', () => {
    expect(isClientTooOld('0.1.19', '0.1.18')).toBe(false);
    expect(isClientTooOld('0.2.0', '0.1.18')).toBe(false);
    expect(isClientTooOld('10.0.0', '9.9.9')).toBe(false);
  });

  /** Ten is not less than nine, which a string comparison would get wrong. */
  it('compares numbers rather than text', () => {
    expect(isClientTooOld('0.1.10', '0.1.9')).toBe(false);
    expect(isClientTooOld('0.10.0', '0.9.0')).toBe(false);
  });

  /**
   * A build that predates the header is exactly the population a floor exists
   * to catch, and it is safe to be strict because the floor is off unless
   * somebody sets it.
   */
  it('counts a client that says nothing as too old, once a floor exists', () => {
    expect(isClientTooOld(undefined, '0.1.18')).toBe(true);
    expect(isClientTooOld('not a version', '0.1.18')).toBe(true);
  });

  /**
   * The failure that would be this server breaking a working app. A floor
   * nobody can parse is a typo in a config file, and the safe reading of a typo
   * is the state the server was in before it.
   */
  it('ignores a floor it cannot read rather than locking everyone out', () => {
    expect(isClientTooOld('0.1.18', 'latest')).toBe(false);
    expect(isClientTooOld(undefined, 'v2')).toBe(false);
  });
});

describe('what the farm is told', () => {
  it('says the records are safe and names the one thing to do', () => {
    const said = syncRefusalMessage('appTooOld');

    expect(said).toContain('Nothing has been lost');
    expect(said).toContain('updated');
    // Not a payment state, and it must not read like one.
    expect(said.toLowerCase()).not.toContain('subscri');
  });

  it('states the header once, so the two ends cannot disagree', () => {
    expect(CLIENT_VERSION_HEADER).toBe('x-steading-client');
  });
});
