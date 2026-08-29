import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What a deploy tick decides, on a box where nothing has changed.
 *
 * `homefarm-deploy.timer` runs `deploy.sh` every five minutes, and the two
 * decisions it makes on a quiet tick are the ones that decide whether a broken
 * box looks broken.
 *
 * ## Both used to answer the wrong question
 *
 * **`CHANGED` asked whether HEAD moved during THIS run.** A deploy that
 * fast-forwards and then dies — a failed install, a restart that did not come
 * back, an SSH session dropped in the middle — has already moved HEAD. So the
 * next tick found `WAS = TARGET`, printed "nothing to deploy", and exited 0.
 * For ever: new code on disk, old code in memory, green timer.
 *
 * **The readiness probe was gated on `CHANGED`**, so on a box whose release ref
 * has not moved, nothing on it ever asked whether the API was answering.
 * `homefarm-api.service` carries `StartLimitBurst=5`, so an API that dies five
 * times is one systemd stops restarting — a dead server, a clean
 * `systemctl --failed`, and a deploy timer reporting success around the clock.
 *
 * ## Lifted, not restated
 *
 * The same technique `caddy-deploy.test.ts` uses and for the same reason: a test
 * that restates a shell script is a second copy of the bug. `sed` lifts the
 * actual blocks out of `deploy.sh` by their own text and runs them against
 * stubs, so a rewrite that drops a guard fails here rather than on a farm.
 */

const REPO = join(__dirname, '..', '..');
const DEPLOY = join(REPO, 'scripts', 'deploy', 'deploy.sh');

function lift(from: string, to: string): string {
  return execFileSync('sed', ['-n', `/${from}/,/${to}/p`, DEPLOY], { encoding: 'utf8' });
}

/**
 * Lifts up to but not including a following anchor.
 *
 * The quiet-tick block closes on a bare `fi`, which is not a pattern `sed` can
 * be pointed at — the block contains three of them. So the range is bounded by
 * the line that follows it and that line is dropped, which keeps both ends real
 * text from the script rather than something restated here.
 */
function liftBefore(from: string, until: string): string {
  const lines = lift(from, until).split('\n');
  return lines.slice(0, -2).join('\n');
}

/**
 * Runs the "is there anything to deploy" decision with the two facts it reads
 * supplied, and reports what it concluded.
 */
function decide(at: {
  head: string;
  target: string;
  /** What the box last got all the way through on. Absent = never recorded. */
  deployed?: string;
}): { changed: number; notes: string } {
  const block = lift('^DEPLOYED_MARK=', '^fi$');

  const script = [
    'set -u',
    'NOTES=""',
    'note() { NOTES="$NOTES;$1"; }',
    'die() { NOTES="$NOTES;die"; exit 9; }',
    // The merge is not what this is about; a fast-forward always succeeds here.
    'git() { return 0; }',
    'REF=release',
    `REPO_DIR=${JSON.stringify(REPO)}`,
    `WAS=${JSON.stringify(at.head)}`,
    `TARGET=${JSON.stringify(at.target)}`,
    block,
    'printf "%s|%s" "$CHANGED" "$NOTES"',
  ]
    .join('\n')
    // The marker path is absolute and root-owned; the fixture supplies the read
    // directly rather than writing to /var.
    .replace(
      'DEPLOYED="$(cat "$DEPLOYED_MARK" 2>/dev/null || true)"',
      `DEPLOYED=${JSON.stringify(at.deployed ?? '')}`,
    );

  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
  const [changed, notes] = out.split('|');

  return { changed: Number(changed), notes: notes ?? '' };
}

/**
 * Runs the quiet-tick health check with the API either answering or not, and
 * reports what it did about it.
 */
function quietTick(answering: boolean): { code: number; calls: string } {
  const block = liftBefore('The probe runs on EVERY tick', '^say "Checking it came back"$');
  const trace = join(mkdtempSync(join(tmpdir(), 'tick-')), 'calls');

  const script = [
    'set -u',
    'CHANGED=0',
    'CADDY_WRONG=0',
    'PORT=3001',
    // The commit it is on, which the up-to-date line names.
    'NOW=abc1234',
    'say() { :; }',
    'note() { :; }',
    'sleep() { :; }',
    // Appended to a file rather than a variable: the happy path `exit`s, and a
    // shell variable does not survive that.
    `record() { printf '%s\\n' "$*" >> ${JSON.stringify(trace)}; }`,
    `curl() { record curl; return ${answering ? 0 : 1}; }`,
    'systemctl() { record "systemctl $1"; return 0; }',
    block,
  ].join('\n');

  const run = spawnSync('bash', ['-c', script], { encoding: 'utf8' });

  return {
    code: run.status ?? -1,
    calls: existsSync(trace) ? readFileSync(trace, 'utf8') : '',
  };
}

describe('whether there is anything to deploy', () => {
  it('does nothing when the box is on the release ref and running it', () => {
    const result = decide({ head: 'abc1234', target: 'abc1234', deployed: 'abc1234' });

    expect(result.changed).toBe(0);
    expect(result.notes).toContain('nothing to deploy');
  });

  /**
   * The finding. HEAD moved, the deploy then died, and the old comparison read
   * the moved HEAD as proof the work was done.
   */
  it('finishes a deploy that moved HEAD and then died', () => {
    const result = decide({ head: 'abc1234', target: 'abc1234', deployed: 'old9999' });

    expect(result.changed).toBe(1);
    expect(result.notes).toContain('finishing it');
  });

  /**
   * A box that has never written the marker — which is every box already
   * deployed — does one full pass and then settles. Stated because it is the
   * behaviour on the first tick after this ships.
   */
  it('does one pass on a box that has never recorded a deploy', () => {
    const result = decide({ head: 'abc1234', target: 'abc1234' });

    expect(result.changed).toBe(1);
    expect(result.notes).toContain('unrecorded');
  });

  it('deploys when the release ref has moved ahead', () => {
    const result = decide({ head: 'old9999', target: 'abc1234', deployed: 'old9999' });

    expect(result.changed).toBe(1);
    expect(result.notes).toContain('old9999 -> abc1234');
  });
});

describe('the health check on a tick that deployed nothing', () => {
  /**
   * That it asks at all is the whole finding: this block was skipped entirely
   * when `CHANGED` was zero.
   */
  it('asks whether the API is answering', () => {
    const result = quietTick(true);

    expect(result.calls).toContain('curl');
    expect(result.code).toBe(0);
  });

  /**
   * And acts on the answer. `reset-failed` first, because a start limit that
   * systemd has hit is exactly why nothing is retrying on its own — a plain
   * restart against one is refused.
   */
  it('clears the start limit and restarts a server that has gone away', () => {
    const result = quietTick(false);

    expect(result.calls).toContain('systemctl reset-failed');
    expect(result.calls).toContain('systemctl restart');
    // It does not stop here: the block falls through to the same diagnosis any
    // failed deploy gets, which is what puts the unit in `systemctl --failed`.
    expect(result.code).toBe(0);
  });
});

/**
 * The reload that used to end the run.
 *
 * `systemctl reload caddy` sat unguarded under `set -e`, **between the checkout
 * and the API restart**. A config Caddy would not take therefore left new code
 * installed and the old process still running — and `cmp -s` reported
 * "unchanged" on every tick after, because the file on disk was by then the
 * right one. Nothing would ever try again.
 */
describe('a Caddy reload that fails', () => {
  it('is not the end of the deploy', () => {
    const text = readFileSync(DEPLOY, 'utf8');

    // The bare form is the defect; every reload in this script is guarded.
    for (const line of text.split('\n')) {
      const bare = /^\s*systemctl reload caddy\s*$/.test(line);
      expect(bare, line.trim()).toBe(false);
    }
  });

  /**
   * And it still says so. Swallowing the failure silently would trade one
   * invisible state for another — the point is that the run continues, not that
   * nothing happened.
   */
  it('says which of the two it was', () => {
    const text = readFileSync(DEPLOY, 'utf8');

    expect(text).toContain('caddy refused the reload');
    expect(text).toContain('reloaded for ${DOMAIN}');
  });
});

