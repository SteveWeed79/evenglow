import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileTicket, resetFiling, type SupportConfig } from '@steading/api/support/github';
import type { SupportBundle } from '@steading/contracts';

/**
 * Two reports of one fault must become one issue and a comment.
 *
 * ## The first real use of this loop opened two issues for one fault
 *
 * Two reports had been held on a tablet and were retried together when the
 * support screen opened. They reached the server a second apart, both searched
 * for the fingerprint label, both found nothing — because neither had created
 * its issue yet — and both created one. Issues #95 and #96: same fingerprint,
 * same title, one second between them.
 *
 * Check-then-act, where the check is a network round trip, so the window is
 * wide enough to drive a bus through. The device retrying everything it held
 * the moment somebody opens that screen is not an edge case, it is the design.
 *
 * ## The second time, serialising was not enough
 *
 * Five held reports, one fingerprint, filed sequentially — and it produced
 * **four issues**: #113 at 20:43:02, #114 at :03, #115 at :05, #116 at :06.
 * The fifth, at :26, found #116 and commented.
 *
 * The single-flight was working. Every call was in order and every search
 * returned nothing anyway, because `GET /issues?labels=` is a **listing** and
 * GitHub's listings are eventually consistent — a just-created issue is absent
 * from them for something between five and twenty seconds. Ordering our own
 * calls cannot help when the staleness starts *after* the create returns.
 *
 * **And this suite passed throughout**, because the fake tracker indexed an
 * issue the instant it was made. A fake that is more consistent than the real
 * service tests a race that cannot happen. `tracker()` now lags by default and
 * the twenty-second case is the one that has to be asked for.
 */

const CONFIG: SupportConfig = {
  token: 'a-token',
  owner: 'a-farm',
  repo: 'steading',
  acceptRecords: false,
};

function bundle(over: Partial<SupportBundle> = {}): SupportBundle {
  return {
    v: 1,
    at: 1_786_477_273_151,
    app: { version: '0.1.0', build: 'abc1234', platform: 'android', os: '35' },
    store: { schemaVersion: 5 },
    sync: {
      queued: 0,
      rejected: 0,
      quarantined: 0,
      cleared: 28,
      lastSyncAt: null,
      lastError: null,
      online: true,
    },
    rejections: [],
    errors: [],
    fingerprint: '33sy8nj5q76s',
    ...over,
  } as SupportBundle;
}

type Issue = { number: number; html_url: string; state: 'open' | 'closed' };

/**
 * A tracker that behaves like the real one, which means **its listings lag**.
 *
 * `listVisible` is what makes this a fair fake. The previous version put an
 * issue into the label index the instant it was created, so every arrival
 * found its predecessor and the suite reported a dedup that does not exist —
 * see the header above for the four issues that proves it. GitHub's listings
 * are eventually consistent; reading one issue by number is not.
 */
function tracker(options: { listVisible?: boolean } = {}): {
  issues: number;
  comments: number;
  lists: number;
  close(): void;
} {
  const visible = options.listVisible ?? false;
  const state = { issues: 0, comments: 0, lists: 0, close: (): void => {} };
  const byLabel = new Map<string, Issue>();
  const byNumber = new Map<number, Issue>();

  state.close = (): void => {
    for (const issue of byNumber.values()) issue.state = 'closed';
  };

  vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url.includes('/issues?')) {
      state.lists += 1;
      const label = decodeURIComponent(new URL(url).searchParams.get('labels') ?? '');
      const found = visible ? byLabel.get(label) : undefined;
      // A slow answer, because the race being tested lives in this gap.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json(found === undefined ? [] : [found]);
    }

    // One issue, by number. Strongly consistent, unlike the listing above.
    const single = /\/issues\/(\d+)$/.exec(url);
    if (method === 'GET' && single !== null) {
      const found = byNumber.get(Number(single[1]));
      return found === undefined
        ? new Response('{}', { status: 404 })
        : Response.json(found);
    }

    if (method === 'POST' && url.endsWith('/comments')) {
      state.comments += 1;
      return Response.json({ id: state.comments });
    }

    if (method === 'POST' && url.endsWith('/issues')) {
      state.issues += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as { labels?: string[] };
      const made: Issue = {
        number: state.issues,
        html_url: `https://x/issues/${state.issues}`,
        state: 'open',
      };
      byNumber.set(made.number, made);
      for (const label of body.labels ?? []) {
        if (label.startsWith('fp:')) byLabel.set(label, made);
      }
      return Response.json(made);
    }

    return Response.json({});
  });

  return state;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetFiling();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('two reports of one fault', () => {
  it('opens one issue and comments on it, even arriving together', async () => {
    const state = tracker();

    // Exactly what the support screen does with two held reports.
    const [first, second] = await Promise.all([
      fileTicket(CONFIG, bundle(), undefined),
      fileTicket(CONFIG, bundle(), undefined),
    ]);

    expect(state.issues).toBe(1);
    expect(state.comments).toBe(1);

    // One of them created it and the other found it, and they agree on where.
    expect(first.url).toBe(second.url);
    expect([first.created, second.created].sort()).toEqual([false, true]);
  });

  /**
   * The second bundle is evidence, not a duplicate to discard: it says the fix
   * is still wanted, and it may differ in the field that explains the fault.
   * Handing the second caller the first one's promise would have returned the
   * right URL and silently dropped it.
   */
  it('keeps the second bundle rather than dropping it', async () => {
    const state = tracker();

    await Promise.all([
      fileTicket(CONFIG, bundle({ at: 1 }), undefined),
      fileTicket(CONFIG, bundle({ at: 2 }), undefined),
      fileTicket(CONFIG, bundle({ at: 3 }), undefined),
    ]);

    expect(state.issues).toBe(1);
    expect(state.comments).toBe(2);
  });

  /** Different faults are not serialised against each other. */
  it('does not hold up an unrelated fault', async () => {
    const state = tracker();

    await Promise.all([
      fileTicket(CONFIG, bundle({ fingerprint: 'aaaaaaaaaaaa' }), undefined),
      fileTicket(CONFIG, bundle({ fingerprint: 'bbbbbbbbbbbb' }), undefined),
    ]);

    expect(state.issues).toBe(2);
    expect(state.comments).toBe(0);
  });

  /**
   * The reported failure, exactly: five held reports drained one after another
   * against a tracker whose listing has not caught up. Four issues, before.
   */
  it('files one issue for a queue drained faster than the listing updates', async () => {
    const state = tracker();

    for (const at of [1, 2, 3, 4, 5]) {
      await fileTicket(CONFIG, bundle({ at }), undefined);
    }

    expect(state.issues).toBe(1);
    expect(state.comments).toBe(4);
  });

  /**
   * And it stops asking a question it knows the answer to. One listing for the
   * first report, none after — the create told us the number.
   */
  it('does not consult the listing once it has opened the issue', async () => {
    const state = tracker();

    await fileTicket(CONFIG, bundle({ at: 1 }), undefined);
    await fileTicket(CONFIG, bundle({ at: 2 }), undefined);

    expect(state.lists).toBe(1);
  });

  /**
   * The memory is in-process, so a restart has to fall back to the listing —
   * which by then is correct. Losing it must cost a round trip, not a duplicate.
   */
  it('still finds the issue by label when it has forgotten opening it', async () => {
    const state = tracker({ listVisible: true });

    await fileTicket(CONFIG, bundle({ at: 1 }), undefined);
    resetFiling();
    await fileTicket(CONFIG, bundle({ at: 2 }), undefined);

    expect(state.issues).toBe(1);
    expect(state.comments).toBe(1);
  });

  /**
   * §3 asks for an **open** issue. A defect that was fixed and closed, then
   * reported again, is news — it must open a fresh issue rather than reviving
   * a thread somebody deliberately shut, which is why the remembered number is
   * checked rather than trusted.
   */
  it('opens a new issue when the one it remembers has been closed', async () => {
    const state = tracker();

    await fileTicket(CONFIG, bundle({ at: 1 }), undefined);
    state.close();
    await fileTicket(CONFIG, bundle({ at: 2 }), undefined);

    expect(state.issues).toBe(2);
    expect(state.comments).toBe(0);
  });

  /**
   * A failed filing must not poison the ones behind it. The next report is
   * entitled to its own attempt at a tracker that may have come back.
   */
  it('lets the next report try after one fails', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) throw new Error('the tracker was unreachable');
      return Response.json([]);
    });

    const results = await Promise.allSettled([
      fileTicket(CONFIG, bundle({ fingerprint: 'cccccccccccc' }), undefined),
      fileTicket(CONFIG, bundle({ fingerprint: 'cccccccccccc' }), undefined),
    ]);

    expect(results[0]?.status).toBe('rejected');
    // Attempted rather than skipped — which is the whole point.
    expect(calls).toBeGreaterThan(1);
  });
});
