import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORT_BUNDLE_VERSION, type SupportBundle } from '@steading/contracts';
import { resetApiBase, setApiBase } from '@steading/core/api';
import {
  flushTickets,
  listTickets,
  pendingTickets,
  raiseTicket,
  ticketAsText,
} from '@steading/core/support/tickets';
import { freshStore, readOutboxBySeq, simulateRestart } from '../support/store';

/**
 * A report, held until it can be sent (`docs/SUPPORT-LOOP.md` S6 and S7).
 *
 * **The failure this suite exists for is circular and it is the one that makes
 * support loops useless.** If what is broken is sync, a ticket travelling over
 * the sync transport cannot leave either — the device with the most to report
 * is the one that can report least. So every test below is about what happens
 * when the send does *not* work, because that is the case the loop is for; the
 * happy path is one test.
 *
 * Runs on the real SQLite store rather than a double, for the same reason the
 * queue suites do: the promise being tested is that a report survives the
 * process dying, and only a file can demonstrate that.
 */

const BASE = 'https://farm.test';

const bundle = (over: Partial<SupportBundle> = {}): SupportBundle => ({
  v: SUPPORT_BUNDLE_VERSION,
  at: 1_700_000_000_000,
  app: { version: '0.1.0', platform: 'android' },
  store: { schemaVersion: 5 },
  sync: { queued: 3, rejected: 0, lastSyncAt: null, lastError: 'Network error' },
  rejections: [],
  errors: [{ where: 'flush', message: 'Network error', count: 4 }],
  fingerprint: 'abc123',
  ...over,
});

/** A server that is there and answers. */
function serverAnswers(body: unknown = { ok: true, url: 'https://github.test/issues/1' }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (): Promise<Response> =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

/** A barn with no signal, which is where most of these reports are written. */
function noSignal(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (): Promise<Response> => {
      throw new TypeError('Network request failed');
    }),
  );
}

beforeEach(async () => {
  await freshStore();
  setApiBase(BASE);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiBase();
});

describe('raising one', () => {
  /**
   * The ordering that makes the whole thing a queue rather than a form.
   *
   * A send that succeeds and is never recorded is a report nobody can prove
   * they filed; a ticket recorded and not yet sent is exactly the state this
   * table exists to hold. R6 as well: the press must not wait on a network.
   */
  it('writes the report down before it tries to send it', async () => {
    noSignal();

    const { filed } = await raiseTicket(bundle());

    expect(filed.ok).toBe(false);
    const held = await pendingTickets();
    expect(held).toHaveLength(1);
    expect(held[0]?.fingerprint).toBe('abc123');
  });

  /**
   * S6, and the reason a ticket gets its own table rather than a row in the
   * outbox.
   *
   * A report is not a farm record: it does not sync between a farm's devices,
   * it does not belong to the org's history, and replaying it onto the server
   * as a mutation would be an entity nothing can apply.
   */
  it('never puts a report in the mutation outbox', async () => {
    noSignal();
    await raiseTicket(bundle());

    expect(await readOutboxBySeq()).toHaveLength(0);
  });

  it('survives the process dying', async () => {
    noSignal();
    await raiseTicket(bundle());

    await simulateRestart();

    const held = await pendingTickets();
    expect(held).toHaveLength(1);
    expect(held[0]?.bundle).toContain('abc123');
  });

  it('records what went wrong and how many times, so the screen can say', async () => {
    noSignal();
    await raiseTicket(bundle());

    await flushTickets();
    await flushTickets();

    const held = await pendingTickets();
    expect(held[0]?.attempts).toBe(3);
    expect(held[0]?.lastError).toContain('Network request failed');
  });

  /**
   * An unconfigured build and a barn with no signal are indistinguishable from
   * inside `fetch` (see `boot/config.ts`), and counting attempts against a
   * ticket that was never on a network would have the screen claim it had
   * tried eleven times when it had tried none.
   */
  it('does not count an attempt when the build has no server at all', async () => {
    resetApiBase();
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);

    const { filed } = await raiseTicket(bundle());

    expect(fetched).not.toHaveBeenCalled();
    expect(filed.error).toContain('no farm server');
    expect((await pendingTickets())[0]?.attempts).toBe(0);
  });
});

describe('when it goes', () => {
  it('marks the report sent, keeps the row, and lets go of the records', async () => {
    serverAnswers();

    const { filed } = await raiseTicket(bundle(), JSON.stringify({ sheets: ['a year of eggs'] }));

    expect(filed.ok).toBe(true);
    expect(filed.url).toBe('https://github.test/issues/1');
    expect(await pendingTickets()).toHaveLength(0);

    /**
     * The row stays — the same reasoning as invariant 7: the history is how
     * somebody can tell whether the report they filed ever left the phone.
     * The farm's records do not, because a second copy of a whole database
     * sitting on the handset after it has reached where it was going is a copy
     * nobody asked to keep.
     */
    const [sent] = await listTickets();
    expect(sent?.sentAt).toBeGreaterThan(0);
    expect(sent?.url).toBe('https://github.test/issues/1');
    expect(sent?.records).toBeUndefined();
  });

  it('says when the server took the report but declined the records', async () => {
    serverAnswers({ ok: true, url: 'https://github.test/issues/2', note: 'Your records were not sent.' });

    const { filed } = await raiseTicket(bundle(), '{}');

    expect(filed.ok).toBe(true);
    expect(filed.note).toContain('not sent');
  });

  it('empties what it can and leaves what it cannot', async () => {
    noSignal();
    await raiseTicket(bundle({ fingerprint: 'one' }));
    await raiseTicket(bundle({ fingerprint: 'two' }));
    expect(await pendingTickets()).toHaveLength(2);

    serverAnswers();
    expect(await flushTickets()).toBe(2);
    expect(await pendingTickets()).toHaveLength(0);
  });

  /**
   * A refusal is not a network fault, and the difference matters: this one
   * will not fix itself by being retried in a better field.
   */
  it('keeps a report the server refused, and names the refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (): Promise<Response> =>
          new Response(JSON.stringify({ error: 'This server has nowhere to file a report.' }), {
            status: 501,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const { filed } = await raiseTicket(bundle());

    expect(filed.ok).toBe(false);
    expect(filed.error).toContain('nowhere to file');
    expect(await pendingTickets()).toHaveLength(1);
  });
});

/**
 * The other door (S7). It needs no server, no account and no signal beyond
 * whatever the app it is shared into uses, which is the entire point: this is
 * the path that works when `POST /support` is the thing that is broken.
 */
describe('the share sheet', () => {
  it('carries the fingerprint and the whole lean bundle', () => {
    const text = ticketAsText(bundle({ said: 'the egg total looks wrong' }));

    expect(text).toContain('abc123');
    expect(text).toContain('the egg total looks wrong');
    // Parseable, because the point of S1 is that a machine reads this.
    const fenced = text.slice(text.indexOf('{'));
    expect(JSON.parse(fenced)).toMatchObject({ fingerprint: 'abc123' });
  });

  /**
   * A farm's records are megabytes and no share target would take them as a
   * message — Android throws `TransactionTooLargeException` well before that,
   * which is why `ExportScreen` writes a file. The lean bundle is kilobytes.
   */
  it('never carries the farm records half', () => {
    const text = ticketAsText(bundle());

    expect(text).not.toContain('sheets');
    expect(text.length).toBeLessThan(4096);
  });
});
