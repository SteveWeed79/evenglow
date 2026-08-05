import { describe, expect, it } from 'vitest';
import {
  fingerprintOf,
  hash64,
  SUPPORT_BUNDLE_VERSION,
  supportBundleSchema,
  type SupportBundle,
} from '@steading/contracts';

/**
 * The support bundle, and the fingerprint that decides whether a crash loop
 * becomes one issue or four hundred.
 *
 * `docs/SUPPORT-LOOP.md` calls dedup the thing that makes the whole loop
 * survivable, and it is the only part of it that is pure — so it is the part
 * that can be got right before anything is filed anywhere.
 */

const base = (over: Partial<Parameters<typeof fingerprintOf>[0]> = {}) => ({
  appVersion: '0.1.0',
  schemaVersion: 4,
  errors: [] as { where: string; message: string }[],
  rejections: [] as { entity: string; op: string; reason: string }[],
  ...over,
});

describe('what makes two reports the same defect', () => {
  it('groups the same failure from two devices', () => {
    const one = fingerprintOf(base({ errors: [{ where: 'flush', message: 'Network error' }] }));
    const two = fingerprintOf(base({ errors: [{ where: 'flush', message: 'Network error' }] }));

    expect(one).toBe(two);
  });

  /**
   * The single most important line in the fingerprint.
   *
   * An error that names a record id would otherwise produce one issue per
   * record — which is one issue per morning, per farm. Without this the loop
   * is worse than no loop, because a real defect would be buried under its own
   * reports.
   */
  it('groups a message that names a different record each time', () => {
    const first = fingerprintOf(
      base({ errors: [{ where: 'apply', message: `Record ${'A'.repeat(26)} could not be read` }] }),
    );
    const second = fingerprintOf(
      base({ errors: [{ where: 'apply', message: `Record ${'B'.repeat(26)} could not be read` }] }),
    );

    expect(first).toBe(second);
  });

  it('groups messages that differ only by a number, a uuid or a digest', () => {
    const shapes = [
      'Batch of 12 refused',
      'Batch of 400 refused',
      'Batch of 1 refused',
    ].map((message) => fingerprintOf(base({ errors: [{ where: 'flush', message }] })));

    expect(new Set(shapes).size).toBe(1);

    const uuids = [
      'device 8f14e45f-ce9a-4c5b-8d3e-1a2b3c4d5e6f went away',
      'device 11111111-2222-3333-4444-555555555555 went away',
    ].map((message) => fingerprintOf(base({ errors: [{ where: 'boot', message }] })));

    expect(new Set(uuids).size).toBe(1);
  });

  /**
   * Erring specific is the safe direction: a duplicate issue is an annoyance,
   * and two unrelated defects merged into one thread earn one wrong fix.
   */
  it('separates genuinely different failures', () => {
    const a = fingerprintOf(base({ errors: [{ where: 'flush', message: 'Network error' }] }));
    const b = fingerprintOf(base({ errors: [{ where: 'flush', message: 'Disk full' }] }));
    const c = fingerprintOf(base({ errors: [{ where: 'boot', message: 'Network error' }] }));

    expect(new Set([a, b, c]).size).toBe(3);
  });

  /**
   * The same message from two releases is plausibly two different bugs, and a
   * fix that landed in one of them should not silently close the other.
   */
  it('separates the same message across builds and schema versions', () => {
    const errors = [{ where: 'flush', message: 'Network error' }];

    expect(fingerprintOf(base({ errors }))).not.toBe(
      fingerprintOf(base({ errors, appVersion: '0.2.0' })),
    );
    expect(fingerprintOf(base({ errors }))).not.toBe(
      fingerprintOf(base({ errors, schemaVersion: 5 })),
    );
  });

  it('keys rejections on the entity and the reason, not the record', () => {
    const one = fingerprintOf(
      base({ rejections: [{ entity: 'eggLog', op: 'create', reason: 'count out of range' }] }),
    );
    const two = fingerprintOf(
      base({ rejections: [{ entity: 'eggLog', op: 'create', reason: 'count out of range' }] }),
    );
    const other = fingerprintOf(
      base({ rejections: [{ entity: 'feedLog', op: 'create', reason: 'count out of range' }] }),
    );

    expect(one).toBe(two);
    expect(one).not.toBe(other);
  });

  /**
   * Somebody can raise a ticket because a screen looks odd, with nothing
   * thrown and nothing refused. Those group on what they said — imperfect, and
   * far better than every such report landing in one enormous thread.
   */
  it('falls back to what the person said when nothing went wrong', () => {
    const said = fingerprintOf(base({ said: 'the egg total looks wrong on Tuesday' }));
    const other = fingerprintOf(base({ said: 'the weather row is blank' }));
    const empty = fingerprintOf(base());

    expect(said).not.toBe(other);
    expect(said).not.toBe(empty);
  });

  /**
   * What must NOT be in it: anything that varies per occurrence would give
   * every report a unique fingerprint, which is exactly the flood this
   * prevents.
   */
  it('ignores the things that describe an instance rather than a defect', () => {
    const errors = [{ where: 'flush', message: 'Network error' }];
    // Same defect, different farm, different moment, different queue depth —
    // none of which are inputs at all.
    expect(fingerprintOf(base({ errors }))).toBe(fingerprintOf(base({ errors })));
  });
});

describe('the hash under it', () => {
  it('is stable, short, and the same on any engine', () => {
    // No `crypto`, no BigInt, nothing asynchronous — this runs on Hermes while
    // assembling a bundle on a device that may be about to crash again.
    expect(hash64('steading')).toBe(hash64('steading'));
    expect(hash64('steading').length).toBeLessThanOrEqual(16);
    expect(hash64('a')).not.toBe(hash64('b'));
  });

  it('spreads well enough for a label', () => {
    const seen = new Set(Array.from({ length: 2000 }, (_, i) => hash64(`defect-${i}`)));
    // Not a randomness test — a guard against a hash that collapses, which is
    // how dedup silently merges every defect into one issue.
    expect(seen.size).toBe(2000);
  });
});

describe('the bundle', () => {
  const bundle: SupportBundle = {
    v: SUPPORT_BUNDLE_VERSION,
    at: 1_700_000_000_000,
    app: { version: '0.1.0', platform: 'android' },
    store: { schemaVersion: 4 },
    sync: { queued: 3, rejected: 0, lastSyncAt: null, lastError: null },
    rejections: [],
    errors: [],
    fingerprint: 'abc123',
  };

  it('accepts a lean bundle', () => {
    expect(supportBundleSchema.safeParse(bundle).success).toBe(true);
  });

  /**
   * `.strict()`, and this is the guard that matters: a field nobody described
   * cannot ride along into a ticket. The lean bundle is what makes the loop
   * safe to file on a repository, so what it carries has to be exhaustively
   * named rather than merely mostly named.
   */
  it('refuses a field nobody described', () => {
    expect(supportBundleSchema.safeParse({ ...bundle, email: 'sam@example.test' }).success).toBe(
      false,
    );
    expect(supportBundleSchema.safeParse({ ...bundle, records: [{ eggs: 6 }] }).success).toBe(false);
  });

  it('is versioned, so an old device is readable rather than merely parseable', () => {
    expect(supportBundleSchema.safeParse({ ...bundle, v: 99 }).success).toBe(false);
  });
});
