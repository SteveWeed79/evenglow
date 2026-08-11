import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isStale, modifiedAt } from '../../scripts/lib/cxx-stale.mjs';

/**
 * The native-cache check behind the Windows run scripts.
 *
 * ## Why this file exists at all
 *
 * The logic was a `node -e` one-liner inside `for /f %%R in ('...')`, and it
 * **never ran a single time**. Two `cmd` parses in a row destroyed a snippet
 * made of nested quotes and colons; what a farm saw was
 *
 *   The system cannot find the drive specified.
 *   The system cannot find the drive specified.
 *
 * twice per run, and a guard that silently did nothing. It was reported as
 * scary noise in the middle of a script, which is the only reason it was found
 * — nothing else about the machine looked wrong.
 *
 * A one-liner embedded in a batch string cannot be tested. That is most of
 * what was wrong with it, and it is why the replacement is a file.
 */
describe('whether the native build cache is stale', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cxx-'));

  function at(name: string, when: number): string {
    const file = path.join(dir, name);
    writeFileSync(file, '');
    utimesSync(file, new Date(when), new Date(when));
    return file;
  }

  it('is stale when the packages moved after the build', () => {
    expect(isStale(2_000, 1_000)).toBe(true);
  });

  it('is not stale when the build is the newer of the two', () => {
    expect(isStale(1_000, 2_000)).toBe(false);
  });

  /**
   * A coarse filesystem clock stamps both in the same tick. Clearing on a tie
   * would throw away the native build after every install that followed one,
   * which is a two-minute rebuild charged for nothing.
   */
  it('leaves a tie alone', () => {
    expect(isStale(1_000, 1_000)).toBe(false);
  });

  /**
   * The common case on a machine that has never built for Android, and the one
   * a `Math.max` comparison got wrong: `max(m, NaN)` is `NaN`, so a missing
   * file compared as neither newer nor older and the branch taken was whatever
   * fell out. Absent is absent, and there is nothing to invalidate.
   */
  it('is not stale when there is no native build yet', () => {
    expect(isStale(1_000, null)).toBe(false);
  });

  it('is not stale when there is no install record', () => {
    expect(isStale(null, 1_000)).toBe(false);
  });

  it('reads a real mtime off the disk', () => {
    const file = at('modules.yaml', 1_600_000_000_000);
    expect(modifiedAt(file)).toBeCloseTo(1_600_000_000_000, -3);
  });

  /** Never throws — a missing path is an answer, not a failure. */
  it('reports a path that is not there as null', () => {
    expect(modifiedAt(path.join(dir, 'nothing-here'))).toBeNull();
  });
});
