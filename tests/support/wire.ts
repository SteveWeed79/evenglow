import type { SessionClaims } from '@homefarm/api/auth/claims';
import type { Scoped } from '@homefarm/api/db/scoped';
import { applyBatch } from '@homefarm/api/sync/apply';
import { readSnapshotPage } from '@homefarm/api/sync/snapshot';
import type { SyncTransport } from '@homefarm/core/sync/flush';
import type { PullTransport } from '@homefarm/core/sync/pull';

/**
 * The wire between a device and the real server, minus HTTP.
 *
 * `flushOnce` and `pullOnce` both take a transport, and every existing suite
 * hands them a fake that returns a canned page. That is right for testing the
 * client's own decisions — the watermark, the backoff, the re-sort — and it is
 * exactly wrong for the question a two-device suite asks, which is whether the
 * *server's* answer and the *client's* projection agree. A hand-written page
 * cannot disagree with the server, because it is not the server.
 *
 * So this is the real applier and the real snapshot read, called directly. No
 * Fastify, for the reason `idempotency.test.ts` gives about itself: the
 * assertions are about the write path rather than about HTTP, and a route test
 * would put a JSON round trip between the test and the thing it is checking.
 *
 * Needs a mongod. Everything using it is `describeDb`.
 */
export interface Wire {
  push: SyncTransport;
  pull: PullTransport;
}

export function wireTo(scope: () => Scoped, claims: SessionClaims): Wire {
  return {
    push: async (mutations) => {
      const results = await applyBatch(scope(), claims, mutations);
      return { status: 200, body: { results } };
    },

    pull: async (since, sinceId) => {
      const body = await readSnapshotPage(scope(), { since, sinceId });
      return { status: 200, body };
    },
  };
}
