import { describe, expect, it } from 'vitest';
import { farmOrigin, isRemote } from '../../scripts/lib/api-origin.mjs';
import easJson from '../../apps/mobile/eas.json';

/**
 * Which server a development build talks to.
 *
 * The run scripts rewrite `apps/mobile/.env` on every run, which is what keeps
 * the emulator and USB flows working — a wifi address left behind by yesterday
 * produces an emulator build that can reach nothing. An address deliberately
 * pointed at the deployed server has to survive that, or "test it end to end"
 * lasts exactly one run.
 *
 * The rule is by destination rather than a flag file, so these cases are the
 * whole of it.
 */

describe('addresses the run scripts may overwrite', () => {
  it('treats this machine as scratch', () => {
    for (const local of [
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://[::1]:3001',
      // The emulator's alias for its host. Not a real address anywhere.
      'http://10.0.2.2:3001',
    ]) {
      expect(isRemote(local), local).toBe(false);
    }
  });

  it('treats this network as scratch', () => {
    for (const lan of [
      'http://192.168.1.14:3001',
      'http://10.0.0.7:3001',
      'http://172.16.4.2:3001',
      'http://172.31.255.1:3001',
    ]) {
      expect(isRemote(lan), lan).toBe(false);
    }
  });

  /**
   * The boundary of the 172.16–31 block, which is the one people get wrong.
   * 172.15 and 172.32 are public address space and a build pointed at either
   * was a decision, not a leftover.
   */
  it('does not mistake the neighbours of 172.16/12 for private', () => {
    expect(isRemote('http://172.15.0.1:3001')).toBe(true);
    expect(isRemote('http://172.32.0.1:3001')).toBe(true);
  });

  it('leaves a deployed address alone', () => {
    for (const remote of [
      'https://api.swbuild.dev',
      'https://api-dev.swbuild.dev',
      'https://steading-api.fly.dev',
      // Public IPs are somebody's server too.
      'http://203.0.113.10:3001',
    ]) {
      expect(isRemote(remote), remote).toBe(true);
    }
  });

  it('says no to nothing at all, rather than throwing', () => {
    // An unset value is the normal state of a fresh clone, and the run scripts
    // must be free to fill it in.
    for (const empty of ['', '   ', 'not a url', undefined, null]) {
      expect(isRemote(empty as string)).toBe(false);
    }
  });
});

describe('where the deployed address comes from', () => {
  /**
   * `eas.json` is the one place the hostname is written down. A script with its
   * own copy would give the repo two, and the second would be missed.
   */
  it('reads the real eas.json rather than a fixture', () => {
    const origin = farmOrigin(easJson);
    expect(origin).not.toBeNull();
    expect(isRemote(origin as string)).toBe(true);
    expect(origin).toBe(easJson.build['preview-farm'].env.EXPO_PUBLIC_API_URL);
  });

  /**
   * The state this repo shipped in for weeks: the profile existed and its
   * address was a placeholder. Returning it would point every dev build at a
   * hostname that does not resolve, which fails as a network error and sends
   * somebody looking at their wifi.
   */
  it('refuses a profile with nothing usable in it', () => {
    expect(farmOrigin({ build: { 'preview-farm': { env: { EXPO_PUBLIC_API_URL: '' } } } })).toBeNull();
    expect(farmOrigin({ build: { 'preview-farm': { env: {} } } })).toBeNull();
    expect(farmOrigin({ build: {} })).toBeNull();
    expect(farmOrigin({})).toBeNull();
    expect(farmOrigin(undefined)).toBeNull();
    // A localhost value in that profile is a mistake, not a deployment.
    expect(
      farmOrigin({ build: { 'preview-farm': { env: { EXPO_PUBLIC_API_URL: 'http://localhost:3001' } } } }),
    ).toBeNull();
  });
});
