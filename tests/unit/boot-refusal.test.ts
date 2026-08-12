import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiBase, setApiBase } from '@steading/core/api';
import { resetLocalStore } from '@steading/core/db/store';
import { refreshSession } from '../../apps/mobile/src/auth/session';
import { seedSecureStore } from '../support/native/modules';

/**
 * "Steading could not start. No local store installed."
 *
 * Over an intact database, on a tablet that had been working all week. The one
 * thing that had changed was the server address.
 *
 * ## Why a WORKING server was what broke it
 *
 * `start.ts` establishes the session before it opens the store, and has to:
 * the database is one file per farm and the orgId comes from the session. So
 * on the boot path there is no store yet — eighteen lines of it.
 *
 * `runRefresh` wrote a breadcrumb in that window:
 *
 *   await localStore().recordSessionEnd({ … }).catch(() => undefined);
 *
 * which reads as belt-and-braces and is not. **`localStore()` throws
 * synchronously**, so the `.catch` — attached to the result of
 * `recordSessionEnd` — never runs. The throw escaped `refreshSession`, and
 * `start.ts` awaits it with no catch.
 *
 * It could not happen against a server that was down. An unreachable origin
 * throws inside `fetch`, and that branch returns cached claims without going
 * near the store. Only a server that ANSWERS reaches the refusal path — so
 * this shipped through every offline test, every emulator run, and every day
 * the developer's laptop was not running the API.
 *
 * Pointing a device at a real deployment is exactly the case: the refresh
 * token it held was signed with the other server's secret, so the new one
 * correctly answered 401, and the app would not open.
 *
 * The rule being restored is stated twenty lines further down that same
 * function, for the malformed-pair branch: *nothing on the boot path may
 * throw*. Losing a diagnostic is a smaller loss than losing the app.
 */

const ORG = '01J000000000000000000ORG1';

beforeEach(() => {
  // No store installed — which is the ordinary state of the boot path, not an
  // artificial one. `start.ts` has not reached `openLocalStore` yet.
  resetLocalStore();
  setApiBase('https://api.example.test');
  seedSecureStore({
    'steading.refreshToken': 'a-refresh-token-from-another-server',
    'steading.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role: 'owner' }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiBase();
});

describe('a server that refuses, before the store is open', () => {
  /**
   * The reported failure, exactly. 401 is what a real deployment answers to a
   * token another deployment signed.
   */
  it('does not throw when the server refuses the token', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));

    await expect(refreshSession()).resolves.toBeNull();
  });

  /** 403 takes the same branch and had the same defect. */
  it('does not throw on a 403 either', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 403 }));

    await expect(refreshSession()).resolves.toBeNull();
  });

  /**
   * The other call site: a device that has held claims but has no refresh
   * token. Same shape, same window, same throw — and it never reached a
   * server at all, so nothing about being online protected it.
   */
  it('does not throw when the token is gone but claims remain', async () => {
    seedSecureStore({
      'steading.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role: 'owner' }),
    });
    vi.stubGlobal('fetch', async () => {
      throw new Error('should not be called — there is no token to send');
    });

    await expect(refreshSession()).resolves.toBeNull();
  });

  /**
   * The branch that always worked, kept so the fix cannot quietly change it.
   * A server that is DOWN must not end a session — a farmer in a barn stays
   * signed in, which is the premise of the whole app.
   */
  it('still keeps the session when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });

    await expect(refreshSession()).resolves.toMatchObject({ orgId: ORG });
  });
});
