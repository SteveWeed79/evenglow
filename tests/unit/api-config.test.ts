import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBase, resetApiBase } from '@homefarm/core/api';
import {
  apiFault,
  configureApi,
  explainFault,
  resetApiFault,
  resolveApiConfig,
} from '@homefarm/mobile/boot/config';

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
const stopTriggers = vi.fn();
const setStorageBacking = vi.fn();

const ensureLocalOrgId = vi.fn(async () => 'localOrg');
const setSyncHeld = vi.fn(async (_refusal: string | null) => undefined);
const getSyncHeld = vi.fn(async (): Promise<string | null> => null);

vi.mock('@homefarm/mobile/auth/session', () => ({
  refreshSession: () => refreshSession(),
}));
vi.mock('@homefarm/mobile/auth/local-org', () => ({
  ensureLocalOrgId: () => ensureLocalOrgId(),
}));
vi.mock('@homefarm/mobile/db/store', () => ({
  openLocalStore: (orgId: string) => openLocalStore(orgId),
}));
/**
 * The boot writes one thing to the store itself: whether this device has an
 * account, so the chip can say "on this phone" instead of "1,400 waiting"
 * forever. That is the only reason it is here.
 */
vi.mock('@homefarm/core/db/store', () => ({
  localStore: () => ({
    getSyncHeld: () => getSyncHeld(),
    setSyncHeld: (refusal: string | null) => setSyncHeld(refusal),
  }),
}));
vi.mock('@homefarm/mobile/sync/triggers', () => ({
  startTriggers: () => startTriggers(),
  stopTriggers: () => stopTriggers(),
}));
vi.mock('@homefarm/core/sync/engine', () => ({
  startSync: () => startSync(),
  stopSync: () => stopSync(),
}));
vi.mock('@homefarm/core/sync/storage', () => ({
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
    const { start } = await import('@homefarm/mobile/boot/start');
    refreshSession.mockResolvedValue(CLAIMS);

    const started = await start('');

    // The whole point: no throw, and the database is open.
    expect(started.claims).toEqual(CLAIMS);
    expect(openLocalStore).toHaveBeenCalledWith('org1');
    expect(setStorageBacking).toHaveBeenCalledWith('device');
  });

  it('starts nothing that touches the network', async () => {
    const { start } = await import('@homefarm/mobile/boot/start');
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

  /**
   * **This used to be the one fatal case, and it is now the ordinary one.**
   *
   * The old reasoning was sound for the app it described: no cached claims
   * meant no orgId, so no database and no offline answer to give. A2.1
   * removed the premise. A device with no account has an org it minted itself,
   * so it has a database, so there is nothing a missing server address can
   * take away from it.
   *
   * A first launch with no `.env` — which is every fresh clone, since `.env`
   * is gitignored — now opens a working farm.
   */
  it('opens the farm the device minted, with no session and no server', async () => {
    const { start } = await import('@homefarm/mobile/boot/start');
    refreshSession.mockResolvedValue(null);

    const started = await start('');

    expect(started.claims).toBeNull();
    expect(started.orgId).toBe('localOrg');
    expect(openLocalStore).toHaveBeenCalledWith('localOrg');
    expect(setStorageBacking).toHaveBeenCalledWith('device');
    expect(started.fault).toEqual({ kind: 'missing' });
  });
});

describe('booting without an account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiFault();
    resetApiBase();
    refreshSession.mockResolvedValue(null);
  });

  /**
   * The chip's whole problem, fixed at the only place that knows.
   *
   * With no account the loop never starts, so nothing ever writes a refusal —
   * and `currentState` fell through to `queued`, painting a farm's permanent,
   * supported, by-design free-tier state as "1,400 waiting" in damson on every
   * screen. Written to the store rather than held in memory so the first frame
   * after a cold start is already right.
   */
  it('records that there is no account, so the chip does not say "waiting"', async () => {
    const { start } = await import('@homefarm/mobile/boot/start');

    await start('http://10.0.2.2:3001');

    expect(setSyncHeld).toHaveBeenCalledWith('noAccount');
  });

  it('opens the minted farm and leaves the loop alone', async () => {
    const { start } = await import('@homefarm/mobile/boot/start');

    const started = await start('http://10.0.2.2:3001');

    expect(openLocalStore).toHaveBeenCalledWith('localOrg');

    /**
     * Configured server, no token — and still nothing starts.
     *
     * Every batch would 401, and the engine reads that as "stay queued, do
     * not burn an attempt", which is right and is also a queue that silently
     * never sends behind a chip claiming to be trying. Nothing is lost: the
     * mutations are durable in SQLite, and claiming the farm is what turns
     * them loose.
     */
    expect(startSync).not.toHaveBeenCalled();
    expect(startTriggers).not.toHaveBeenCalled();
    expect(started.fault).toBeNull();
  });

  it('carries the minted id forward rather than minting a second one', async () => {
    const { start } = await import('@homefarm/mobile/boot/start');

    await start('http://10.0.2.2:3001');
    await start('http://10.0.2.2:3001');

    // A second mint would orphan a database full of records: the file is
    // named for this value.
    expect(ensureLocalOrgId).toHaveBeenCalledTimes(2);
    expect(openLocalStore).toHaveBeenNthCalledWith(1, 'localOrg');
    expect(openLocalStore).toHaveBeenNthCalledWith(2, 'localOrg');
  });
});

describe('booting normally', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiFault();
    resetApiBase();
  });

  /**
   * Signing in is the one transition the app performs itself, so it is the one
   * hold the app may clear. `unsubscribed` and `lapsed` are the server's
   * answer and only a successful flush withdraws them — see flush.ts.
   */
  it('clears a stale no-account hold once somebody signs in', async () => {
    const { start } = await import('@homefarm/mobile/boot/start');
    refreshSession.mockResolvedValue(CLAIMS);
    getSyncHeld.mockResolvedValue('noAccount');

    await start('http://10.0.2.2:3001');

    expect(setSyncHeld).toHaveBeenCalledWith(null);
  });

  it('leaves a payment hold alone, because only the server can lift one', async () => {
    const { start } = await import('@homefarm/mobile/boot/start');
    refreshSession.mockResolvedValue(CLAIMS);
    getSyncHeld.mockResolvedValue('unsubscribed');

    await start('http://10.0.2.2:3001');

    expect(setSyncHeld).not.toHaveBeenCalled();
  });

  it('starts the loop and the triggers', async () => {
    const { start } = await import('@homefarm/mobile/boot/start');
    refreshSession.mockResolvedValue(CLAIMS);

    const started = await start('http://10.0.2.2:3001');

    expect(started.fault).toBeNull();
    expect(startSync).toHaveBeenCalled();
    expect(startTriggers).toHaveBeenCalled();
  });

  /**
   * Both, and the triggers by the module rather than by a captured handle.
   *
   * `start()` attaches none on the no-account boot, so the set that exists at
   * teardown can be the one `Boot.onSignedIn` attached. Stopping only its own
   * would leave those listening against a closed store.
   */
  it('stops both when torn down', async () => {
    const { start } = await import('@homefarm/mobile/boot/start');
    refreshSession.mockResolvedValue(CLAIMS);

    const started = await start('http://10.0.2.2:3001');
    started.stop();

    expect(stopSync).toHaveBeenCalled();
    expect(stopTriggers).toHaveBeenCalled();
  });

  it('shows the door, and no fault, when nobody is signed in', async () => {
    const { start } = await import('@homefarm/mobile/boot/start');
    refreshSession.mockResolvedValue(null);

    const started = await start('http://10.0.2.2:3001');

    expect(started.claims).toBeNull();
    expect(started.fault).toBeNull();
    expect(startSync).not.toHaveBeenCalled();
  });
});
