import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileTicket, type SupportConfig } from '@steading/api/support/github';
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

/**
 * A tracker that behaves like the real one: an issue is only findable by its
 * label once it has actually been created.
 */
function tracker(): { issues: number; comments: number } {
  const state = { issues: 0, comments: 0 };
  const byLabel = new Map<string, { number: number; html_url: string }>();

  vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url.includes('/issues?')) {
      const label = decodeURIComponent(new URL(url).searchParams.get('labels') ?? '');
      const found = byLabel.get(label);
      // A slow answer, because the race being tested lives in this gap.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json(found === undefined ? [] : [found]);
    }

    if (method === 'POST' && url.endsWith('/comments')) {
      state.comments += 1;
      return Response.json({ id: state.comments });
    }

    if (method === 'POST' && url.endsWith('/issues')) {
      state.issues += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as { labels?: string[] };
      const made = { number: state.issues, html_url: `https://x/issues/${state.issues}` };
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
