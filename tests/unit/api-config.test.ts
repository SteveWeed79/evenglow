import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBase, resetApiBase } from '@steading/core/api';
import {
  apiFault,
  configureApi,
  explainFault,
  resetApiFault,
  resolveApiConfig,
} from '@steading/mobile/boot/config';

/**
 * An offline-first app must open without a server.
 *
 * The bug this covers: `start()` threw when `EXPO_PUBLIC_API_URL` was unset,
 * so a fresh clone — `.env` is gitignored, so every clone — met a full-screen
 * "Steading could not start". On a farm that had been using the app, the same
 * throw would have withheld a database full of records that were sitting on
 * the device, under a message reading "nothing you have logged is lost".
 *
 * The worry behind the throw was legitimate and is preserved below: an
 * unconfigured build must never look like bad signal. It is answered by
 * naming the fault and refusing to start the loop, not by refusing to boot.
 */

beforeEach(() => {
  resetApiFault();
  resetApiBase();
});

describe('reading the configured origin', () => {
  it('accepts an ordinary origin', () => {
    expect(resolveApiConfig('http://10.0.2.2:3001')).toEqual({
      kind: 'configured',
      base: 'http://10.0.2.2:3001',
    });
    expect(resolveApiConfig('https://farm.example.com')).toEqual({
      kind: 'configured',
      base: 'https://farm.example.com',
    });
  });

  it('treats unset, empty and whitespace alike', () => {
    // A `.env` line left as `EXPO_PUBLIC_API_URL=` is not a configured app,
    // and Expo inlines it as an empty string rather than as undefined.
    expect(resolveApiConfig(undefined).kind).toBe('missing');
    expect(resolveApiConfig('').kind).toBe('missing');
    expect(resolveApiConfig('   ').kind).toBe('missing');
  });

  it('refuses a relative path, because a handset has no origin to resolve it against', () => {
    const config = resolveApiConfig('/api');
    expect(config.kind).toBe('malformed');
  });

  it('refuses a scheme that is not http or https, and says which it got', () => {
    const config = resolveApiConfig('ftp://farm.example.com');
    expect(config.kind).toBe('malformed');
    if (config.kind === 'malformed') expect(config.detail).toContain('ftp');
  });

  it('trims, so a trailing newline in a .env is not a malformed address', () => {
    expect(resolveApiConfig(' http://10.0.2.2:3001\n')).toEqual({
      kind: 'configured',
      base: 'http://10.0.2.2:3001',
    });
  });
});

describe('applying it', () => {
  it('points the transports at the origin and records no fault', () => {
    const config = configureApi('http://10.0.2.2:3001');

    expect(config.kind).toBe('configured');
    expect(apiBase()).toBe('http://10.0.2.2:3001');
    expect(apiFault()).toBeNull();
  });

  it('records a fault and leaves the transports unpointed', () => {
    configureApi(undefined);

    expect(apiFault()).toEqual({ kind: 'missing' });
    // Emphatically not a garbage base. `undefined/sync` would fail as a
    // network error, which is exactly what a barn with no signal looks like.
    expect(apiBase()).toBeNull();
  });

  it('does not leave a stale fault behind once configured', () => {
    configureApi(undefined);
    expect(apiFault()).not.toBeNull();

    configureApi('https://farm.example.com');
    expect(apiFault()).toBeNull();
  });
});

describe('what it tells a farmer', () => {
  it('says the records are safe before it says anything is wrong', () => {
    const message = explainFault({ kind: 'missing' });

    expect(message).toContain('saved on this device');
    expect(message).toContain('none of it is at risk');
    // Named plainly, so it can be read back to whoever can help.
    expect(message).toContain('EXPO_PUBLIC_API_URL');
  });

  it('quotes the address it could not use', () => {
    const message = explainFault({
      kind: 'malformed',
      value: 'localhost:3001',
      detail: 'that is not a whole web address',
    });

    expect(message).toContain('localhost:3001');
    expect(message).toContain('none of it is at risk');
  });
});

// ── the boot itself ──────────────────────────────────────────────────────────

const refreshSession = vi.fn();
const openLocalStore = vi.fn(async (_orgId: string) => undefined);
const startSync = vi.fn();
const stopSync = vi.fn();
const startTriggers = vi.fn(() => ({ stop: vi.fn() }));
const setStorageBacking = vi.fn();

vi.mock('@steading/mobile/auth/session', () => ({
  refreshSession: () => refreshSession(),
}));
vi.mock('@steading/mobile/db/store', () => ({
  openLocalStore: (orgId: string) => openLocalStore(orgId),
}));
vi.mock('@steading/mobile/sync/triggers', () => ({
  startTriggers: () => startTriggers(),
}));
vi.mock('@steading/core/sync/engine', () => ({
  startSync: () => startSync(),
  stopSync: () => stopSync(),
}));
vi.mock('@steading/core/sync/storage', () => ({
  setStorageBacking: (backing: string) => setStorageBacking(backing),
}));

const CLAIMS = { userId: 'u1', orgId: 'org1', role: 'owner' as const };

describe('booting with no server address', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiFault();
    resetApiBase();
  });

  it('opens the farm anyway when somebody is already signed in', async () => {
    const { start } = await import('@steading/mobile/boot/start');
    refreshSession.mockResolvedValue(CLAIMS);

    const started = await start('');

    // The whole point: no throw, and the database is open.
    expect(started.claims).toEqual(CLAIMS);
    expect(openLocalStore).toHaveBeenCalledWith('org1');
    expect(setStorageBacking).toHaveBeenCalledWith('device');
  });

  it('starts nothing that touches the network', async () => {
    const { start } = await import('@steading/mobile/boot/start');
    refreshSession.mockResolvedValue(CLAIMS);

    const started = await start('');

    /**
     * The queue must not run against a base that is not there. Every flush
     * would fail as a network error, the engine would back off — correctly,
     * for what it can see — and the chip would report the ordinary offline
     * story forever. That is the failure the old boot-time throw was aimed at,
     * and it is prevented here rather than by withholding the app.
     */
    expect(startSync).not.toHaveBeenCalled();
    expect(startTriggers).not.toHaveBeenCalled();
    expect(started.fault).toEqual({ kind: 'missing' });
  });

  it('is still fatal when nobody is signed in, because signing in needs a server', async () => {
    const { start } = await import('@steading/mobile/boot/start');
    refreshSession.mockResolvedValue(null);

    // No cached claims means no orgId, so there is no database to open and no
    // offline answer to give. Saying so beats a sign-in form that fails on
    // every tap with a network error.
    await expect(start('')).rejects.toThrow(/EXPO_PUBLIC_API_URL/);
  });
});

describe('booting normally', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiFault();
    resetApiBase();
  });

  it('starts the loop and the triggers', async () => {
    const { start } = await import('@steading/mobile/boot/start');
    refreshSession.mockResolvedValue(CLAIMS);

    const started = await start('http://10.0.2.2:3001');

    expect(started.fault).toBeNull();
    expect(startSync).toHaveBeenCalled();
    expect(startTriggers).toHaveBeenCalled();
  });

  it('stops both when torn down', async () => {
    const { start } = await import('@steading/mobile/boot/start');
    refreshSession.mockResolvedValue(CLAIMS);

    const started = await start('http://10.0.2.2:3001');
    started.stop();

    expect(stopSync).toHaveBeenCalled();
  });

  it('shows the door, and no fault, when nobody is signed in', async () => {
    const { start } = await import('@steading/mobile/boot/start');
    refreshSession.mockResolvedValue(null);

    const started = await start('http://10.0.2.2:3001');

    expect(started.claims).toBeNull();
    expect(started.fault).toBeNull();
    expect(startSync).not.toHaveBeenCalled();
  });
});
