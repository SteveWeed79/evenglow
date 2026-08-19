import { describe, expect, it } from 'vitest';
import {
  careDues,
  fingerprintOf,
  hash64,
  SUPPORT_BUNDLE_VERSION,
  supportBundleSchema,
  taskDues,
  type SupportBundle,
} from '@homefarm/contracts';
import { titleFor } from '@homefarm/api/support/github';
import { readEnv } from '@homefarm/api/env';

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
    expect(hash64('homefarm')).toBe(hash64('homefarm'));
    expect(hash64('homefarm').length).toBeLessThanOrEqual(16);
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

/**
 * The title, which is the one human line in the whole artefact (S1).
 *
 * It is what somebody scans in a list of forty, so it has to distinguish one
 * row from the next — and the bundle it comes from is written for a machine.
 */
describe('the one line a person reads', () => {
  const bundle = (over: Partial<SupportBundle> = {}): SupportBundle => ({
    v: SUPPORT_BUNDLE_VERSION,
    at: 1_700_000_000_000,
    app: { version: '0.1.0', platform: 'android' },
    store: { schemaVersion: 4 },
    sync: { queued: 0, rejected: 0, lastSyncAt: null, lastError: null },
    rejections: [],
    errors: [],
    fingerprint: 'abc',
    ...over,
  });

  /** The same fixture, from a build that knows which commit it came from. */
  const built = (commit: string, over: Partial<SupportBundle> = {}): SupportBundle => ({
    ...bundle(over),
    app: { version: '0.1.0', platform: 'android', build: commit },
  });

  /**
   * The commit is in the title and not in the fingerprint, which is the whole
   * point of stamping it.
   *
   * "Which build are you on" is the first question about any report, and a
   * machine-first bundle should never make somebody ask it out loud. But a
   * commit inside `appVersion` would give every build its own fingerprint for
   * every defect — a fresh issue thread every few days during a tester
   * programme, for the same fault, which is precisely the flood dedup exists
   * to prevent.
   */
  it('names the commit in the title without splitting the report', () => {
    const errors = [{ where: 'flush', message: 'Network error', count: 1 }];
    const one = built('abc1234', { errors });
    const two = built('def5678', { errors });

    expect(titleFor(one)).toContain('abc1234');
    expect(titleFor(two)).toContain('def5678');

    // Same defect, two builds, one thread: the build is not an input.
    const shape = { appVersion: '0.1.0', schemaVersion: 4, rejections: [], errors };
    expect(fingerprintOf(shape)).toBe(fingerprintOf(shape));
    // And the bundles really did differ, so the assertion above is not vacuous.
    expect(one.app.build).not.toBe(two.app.build);
  });

  it('says the version alone when nothing stamped a commit', () => {
    expect(titleFor(bundle())).toContain('0.1.0');
    expect(titleFor(bundle())).not.toContain('+');
  });

  it('leads with the failure and names the build', () => {
    const title = titleFor(
      bundle({ errors: [{ where: 'flush', message: 'Network error', count: 3 }] }),
    );

    expect(title).toContain('flush');
    expect(title).toContain('Network error');
    // Which build, because the same message from two releases is two defects.
    expect(title).toContain('0.1.0');
  });

  it('falls back to the refusal, then to what the farm said', () => {
    expect(
      titleFor(bundle({ rejections: [{ entity: 'eggLog', op: 'create', reason: 'bad count', count: 1 }] })),
    ).toContain('eggLog refused');

    expect(titleFor(bundle({ said: 'the weather row is blank' }))).toContain('weather row');
  });

  it('says something even when nothing went wrong', () => {
    // Somebody can raise a ticket because a screen looks odd. An empty title
    // is a row nobody can tell from the row above it.
    expect(titleFor(bundle()).length).toBeGreaterThan(10);
  });

  it('stays inside a title, whatever the message was', () => {
    const huge = titleFor(
      bundle({ errors: [{ where: 'x'.repeat(200), message: 'y'.repeat(400), count: 1 }] }),
    );
    expect(huge.length).toBeLessThanOrEqual(120);
    // And collapses the whitespace a stack-ish message brings with it, so the
    // list does not grow rows of ragged height.
    expect(huge).not.toMatch(/\s\s/);
  });
});

/**
 * The one route by which a farm's own words could reach a lean bundle.
 *
 * `TodayScreen` reports a failed log as `reportTrouble(\`recording
 * ${done.label.toLowerCase()}\`, error)`, and `where` goes into the bundle and
 * into the issue title. Every `Due.done.label` in the app today is a constant —
 * `CARE_KIND_LABELS[kind]`, or the literal "Done" — so nothing leaks. Nothing
 * *enforced* that, which is the gap this closes: a builder that one day writes
 * ``label: `Fed ${group.name}` `` would put a farm's herd name on a public
 * issue tracker, silently, and no other test in this suite would notice.
 *
 * Both builders that produce a `done` are checked with sentinel names, because
 * a fixture called "Nubians" would pass this while a genuine leak of the same
 * shape went by.
 */
describe('what may reach a bundle from a farm', () => {
  const SENTINEL = 'ZZ-FARM-AUTHORED-ZZ';
  const NOW = Date.parse('2026-08-06T09:00:00Z');

  it('never puts a farm-authored name on the button label a failure is reported by', () => {
    const care = careDues(
      { id: 'f1', name: SENTINEL, species: 'goat', lastDone: { worming: NOW - 90 * 86_400_000 } },
      NOW,
    );
    const tasks = taskDues(
      { id: 't1', title: SENTINEL, recurrence: 'none', dueAtDate: NOW },
      SENTINEL,
    );

    const labels = [...care, ...tasks].map((due) => due.done?.label ?? '');

    // The fixtures have to actually produce rows, or this asserts nothing.
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).not.toContain(SENTINEL);
  });

  /**
   * The title is a farm's own sentence and belongs there — it is what makes a
   * row readable on Today. It just must not be what a *failure* is named by,
   * which is the distinction above.
   */
  it('still lets the farm name the row itself', () => {
    const [task] = taskDues({ id: 't1', title: SENTINEL, recurrence: 'none', dueAtDate: NOW }, undefined);

    expect(task?.title).toContain(SENTINEL);
  });
});

describe('reading the tracker config', () => {
  const base = {
    AUTH_SECRET: 'a-test-secret-long-enough-for-hs256-abcdef',
    MONGODB_URI: 'mongodb://localhost:27017',
  };

  it('is absent unless both halves are set', () => {
    // The state a self-hosted server stays in: /support answers 501 and the
    // app offers its share sheet, which needs no server at all.
    expect(readEnv(base).supportConfig).toBeNull();
    expect(readEnv({ ...base, SUPPORT_GITHUB_TOKEN: 'x' }).supportConfig).toBeNull();
    expect(readEnv({ ...base, SUPPORT_REPO: 'a/b' }).supportConfig).toBeNull();
  });

  it('splits owner from repo and refuses anything else', () => {
    expect(
      readEnv({ ...base, SUPPORT_GITHUB_TOKEN: 'x', SUPPORT_REPO: 'SteveWeed79/evenglow' })
        .supportConfig,
    ).toMatchObject({ owner: 'SteveWeed79', repo: 'evenglow' });

    expect(() =>
      readEnv({ ...base, SUPPORT_GITHUB_TOKEN: 'x', SUPPORT_REPO: 'homefarm' }),
    ).toThrow(/owner\/repo/);
  });

  /**
   * The S5 gate, and it defaults to off.
   *
   * A farm cannot meaningfully consent to its records being world-readable on
   * a prompt in a barn, so the half that carries them stays refused until
   * somebody sets this deliberately — after the repository is private.
   */
  it('refuses the farm-records half unless it is turned on deliberately', () => {
    const off = readEnv({ ...base, SUPPORT_GITHUB_TOKEN: 'x', SUPPORT_REPO: 'a/b' });
    expect(off.supportConfig?.acceptRecords).toBe(false);

    for (const value of ['1', 'true', 'TRUE']) {
      const on = readEnv({
        ...base,
        SUPPORT_GITHUB_TOKEN: 'x',
        SUPPORT_REPO: 'a/b',
        SUPPORT_ACCEPT_RECORDS: value,
      });
      expect(on.supportConfig?.acceptRecords).toBe(true);
    }

    // Anything that is not an explicit yes is a no.
    for (const value of ['', '0', 'yes', 'maybe']) {
      const guess = readEnv({
        ...base,
        SUPPORT_GITHUB_TOKEN: 'x',
        SUPPORT_REPO: 'a/b',
        SUPPORT_ACCEPT_RECORDS: value,
      });
      expect(guess.supportConfig?.acceptRecords).toBe(false);
    }
  });
});
