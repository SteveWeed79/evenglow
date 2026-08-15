import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@steading/contracts';
import { setSessionRefresher, type SessionRenewal } from '@steading/core/api';
import { flushOnce } from '@steading/core/sync/flush';
import { enqueue, queueDepth } from '@steading/core/sync/queue';
import { pullOnce } from '@steading/core/sync/pull';
import { localStore } from '@steading/core/db/store';
import { freshStore, readRecordsByEntity } from '../support/store';

/**
 * A session that lapses while the app is open.
 *
 * Access tokens last fifteen minutes. The loop treated 401 as a deferral and
 * had no way to mint a new one, so a phone left foregrounded and online simply
 * stopped syncing at the quarter hour and stayed stopped until a lifecycle
 * event happened to occur — behind a chip reporting work waiting and an error
 * telling a signed-in farmer to sign in.
 *
 * Nothing was ever at risk: `flush.ts` deliberately skips `recordAttempt` on a
 * 401, so `MAX_ATTEMPTS` never ripens and no mutation is swept to the inbox.
 * What was lost was timeliness and trust, which is why the message matters as
 * much as the retry.
 */

function eggLog() {
  return {
    entity: 'eggLog' as const,
    op: 'create' as const,
    payload: { occurredAt: 1_700_000_000_000, flockId: newId(), count: 18 },
  };
}

function refresher(answer: SessionRenewal, onCall?: () => void) {
  return () => {
    onCall?.();
    return Promise.resolve(answer);
  };
}

beforeEach(async () => {
  await freshStore();
  setSessionRefresher(null);
});

afterEach(() => setSessionRefresher(null));

describe('a flush that meets a lapsed session', () => {
  it('renews once and sends the same batch again', async () => {
    await enqueue(eggLog());

    let renewed = false;
    let calls = 0;
    setSessionRefresher(() => {
      renewed = true;
      return Promise.resolve<SessionRenewal>('renewed');
    });

    const outcome = await flushOnce((mutations) => {
      calls += 1;
      if (!renewed) return Promise.resolve({ status: 401, body: null });
      return Promise.resolve({
        status: 200,
        body: {
          results: mutations.map((m) => ({ id: m.id, status: 'applied' })),
          serverTs: Date.now(),
        },
      });
    });

    expect(outcome.applied).toBe(1);
    expect(outcome.deferred).toBeUndefined();
    expect(calls).toBe(2);
    expect(await queueDepth()).toBe(0);
  });

  /**
   * Once, not in a loop. A second 401 after a successful renewal is a refusal
   * about this request rather than about the session, and retrying it would
   * spin at whatever rate the engine ticks.
   */
  it('does not keep retrying when the new token is refused too', async () => {
    await enqueue(eggLog());

    let renewals = 0;
    let calls = 0;
    setSessionRefresher(() => {
      renewals += 1;
      return Promise.resolve<SessionRenewal>('renewed');
    });

    const outcome = await flushOnce(() => {
      calls += 1;
      return Promise.resolve({ status: 401, body: null });
    });

    expect(renewals).toBe(1);
    expect(calls).toBe(2);
    expect(outcome.deferred).toBe('unauthenticated');
  });

  it('keeps the work queued and burns no attempt', async () => {
    await enqueue(eggLog());
    setSessionRefresher(refresher('signed-out'));

    await flushOnce(() => Promise.resolve({ status: 401, body: null }));

    // A 401 is not the mutation's fault, so MAX_ATTEMPTS must never ripen from
    // one — nothing may be swept to the inbox over an expired token.
    const [row] = await localStore().readOutboxBySeq();
    expect(row?.attempts).toBe(0);
    expect(await queueDepth()).toBe(1);
  });

  /**
   * The two failures are different instructions, and the sentence that shipped
   * gave the wrong one to whoever was more likely to see it: an app whose token
   * simply expired told its signed-in owner to sign in.
   */
  it('says sign in only when the server actually refused', async () => {
    await enqueue(eggLog());
    setSessionRefresher(refresher('signed-out'));

    await flushOnce(() => Promise.resolve({ status: 401, body: null }));

    expect(await localStore().getLastError()).toContain('sign in again');
  });

  it('says the server could not be reached when that is what happened', async () => {
    await enqueue(eggLog());
    setSessionRefresher(refresher('unavailable'));

    await flushOnce(() => Promise.resolve({ status: 401, body: null }));

    const message = await localStore().getLastError();
    expect(message).toContain('could not be reached');
    expect(message).not.toContain('sign in again');
  });

  it('still reassures that nothing is lost, either way', async () => {
    await enqueue(eggLog());

    for (const answer of ['signed-out', 'unavailable'] as const) {
      setSessionRefresher(refresher(answer));
      await flushOnce(() => Promise.resolve({ status: 401, body: null }));
      expect(await localStore().getLastError()).toContain('Nothing is lost');
    }
  });

  it('defers as before when nothing knows how to renew', async () => {
    await enqueue(eggLog());

    const outcome = await flushOnce(() => Promise.resolve({ status: 401, body: null }));

    expect(outcome.deferred).toBe('unauthenticated');
    expect(await queueDepth()).toBe(1);
  });
});

describe('a pull that meets a lapsed session', () => {
  const page = (rows: number) => ({
    status: 200,
    body: {
      mutations: Array.from({ length: rows }, (_, i) => ({
        schemaVersion: 1,
        id: `${'0'.repeat(20)}${String(i).padStart(6, '0')}`,
        targetId: newId(),
        entity: 'flock',
        op: 'create',
        payload: { name: 'Alpha', species: 'chicken', count: 12 },
        deviceId: '00000000-0000-4000-8000-0000000000ff',
        clientSeq: i,
        clientTs: 1,
        serverTs: 10 + i,
      })),
      through: 10 + rows - 1,
      throughId: `${'0'.repeat(20)}${String(rows - 1).padStart(6, '0')}`,
      more: false,
    },
  });

  it('renews once and asks again', async () => {
    let renewed = false;
    setSessionRefresher(() => {
      renewed = true;
      return Promise.resolve<SessionRenewal>('renewed');
    });

    const outcome = await pullOnce(() =>
      renewed
        ? Promise.resolve(page(1))
        : Promise.resolve({ status: 401, body: null }),
    );

    expect(outcome.deferred).toBeUndefined();
    expect(outcome.applied).toBe(1);
    expect(await readRecordsByEntity('flock')).toHaveLength(1);
  });

  it('defers when the renewal does not produce a token', async () => {
    setSessionRefresher(refresher('signed-out'));

    const outcome = await pullOnce(() => Promise.resolve({ status: 401, body: null }));

    expect(outcome.deferred).toBe('unauthenticated');
    expect((await localStore().pulledThrough()).through).toBe(0);
  });

  it('does not loop when the renewed token is refused too', async () => {
    let calls = 0;
    setSessionRefresher(refresher('renewed'));

    const outcome = await pullOnce(() => {
      calls += 1;
      return Promise.resolve({ status: 401, body: null });
    });

    expect(calls).toBe(2);
    expect(outcome.deferred).toBe('server-401');
  });
});
