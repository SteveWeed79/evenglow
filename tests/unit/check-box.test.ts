import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What `check-box.sh` says about a failed unit, and which kind it is.
 *
 * `check:names-ok-file` — the retired name is this file's entire subject. Every
 * `steading-*` below is a unit that really is still on the live box, and the
 * one thing being tested is whether the script tells those apart from a
 * `homefarm-*` unit that has genuinely failed. Rewriting them to the new name
 * would test nothing. `check-box.sh` carries the same marker for the same
 * reason.
 *
 * ## The two dead units, and why they are a finding rather than untidiness
 *
 * `rename-to-homefarm.sh` runs `systemctl disable --now` over the five
 * `steading-*` names and never removes their files. A unit that had already
 * failed stays failed, so every box that was renamed rather than built fresh
 * carries permanent entries in `systemctl --failed` — the live box has carried
 * two since the rename.
 *
 * They serve nothing and cost nothing on their own. What they cost is the
 * alarm: `homefarm-backup-check` reports "no backup in 36 hours" **by going
 * red**, and `systemctl --failed` is where a person would see it. A list that
 * always has something in it is a list nobody reads a new line in.
 *
 * ## The hazard of splitting them out is the thing tested hardest
 *
 * A classifier that sends the wrong way is worse than the single line it
 * replaced: a real failure filed under "left over from the rename" reads as
 * already understood, and the operator moves on. So the case that matters is
 * not the tidy box — it is a genuine failure standing beside two stale ones.
 *
 * ## Lifted, not restated
 *
 * The block is pulled out of the script by its own text and run against a
 * stubbed `systemctl`, the technique `deploy-tick.test.ts` and
 * `caddy-deploy.test.ts` already use here. A test that restated the shell would
 * be a second copy of whatever the shell gets wrong.
 */

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'deploy', 'check-box.sh');

/**
 * Runs the failed-units block with `systemctl --failed` answering with `units`.
 *
 * The block closes on a bare `fi`, which is not a pattern `sed` can be pointed
 * at. So the range is bounded by the heading that follows it and that heading
 * is dropped — both ends stay real text from the script rather than something
 * written here.
 */
function report(units: string[]): string {
  const lifted = execFileSync('sed', ['-n', '/^FAILED=/,/^H "The API"$/p', SCRIPT], {
    encoding: 'utf8',
  });
  const block = lifted.split('\n').slice(0, -3).join('\n');

  /**
   * One argument per unit, not one string with newlines in it.
   *
   * `printf '%s' "a\\nb"` leaves the escape literal — the shell does not
   * interpret `\\n` inside a double-quoted word, only `printf`'s *format*
   * does. The stub then emitted a single line and the classification under test
   * had nothing to classify, which read as the script failing to split.
   */
  const emit = units.length
    ? `printf '%s\\n' ${units.map((u) => JSON.stringify(u)).join(' ')}`
    : ':';

  const script = [
    'set -uo pipefail',
    'OLD=steading',
    'OUT=""',
    'OK(){ OUT="$OUT|ok: $*"; }',
    'NO(){ OUT="$OUT|FAIL: $*"; }',
    'TIP(){ OUT="$OUT|tip: $*"; }',
    `systemctl() { ${emit}; return 0; }`,
    block,
    'printf "%s" "$OUT"',
  ].join('\n');

  return execFileSync('bash', ['-c', script], { encoding: 'utf8' });
}

describe('a box with nothing wrong', () => {
  it('says so once', () => {
    const out = report([]);

    expect(out).toContain('ok: no failed units');
    expect(out).not.toContain('FAIL:');
  });
});

describe('the units the rename left behind', () => {
  it('names them and does not call them a service failure', () => {
    const out = report(['steading-api.service', 'steading-deploy.service']);

    // Nothing is actually failing, and the line that reports live units says so.
    expect(out).toContain('ok: no failed units');
    expect(out).toContain('FAIL: left over from the rename, permanently red: steading-api.service');
    expect(out).toContain('steading-deploy.service');
  });

  /**
   * The whole reason the line exists. Reporting a permanent red without saying
   * how to clear it is how it became permanent.
   */
  it('says how to clear them, and looks before removing', () => {
    const out = report(['steading-api.service']);

    expect(out).toContain('tip:     ls -la /etc/systemd/system/steading-*');
    expect(out).toContain('systemctl daemon-reload && sudo systemctl reset-failed');
    /**
     * `-rf` over a bare prefix, not a `.service` glob. The live box carries
     * `steading-api.service.d/netlink.conf`, and a pattern ending in `.service`
     * walks past a drop-in directory and orphans it.
     */
    expect(out).toContain('rm -rf /etc/systemd/system/steading-*');
    expect(out).not.toContain('rm -f /etc/systemd/system/steading-*.service');
    /**
     * Disabled before the files go, or an enabled unit leaves dangling
     * `*.wants/` symlinks that `daemon-reload` then complains about. The units
     * are named, so the paste does not disable something the glob would have
     * covered but this box does not have.
     */
    expect(out).toContain('disable --now steading-api.service 2>/dev/null');
  });

  /** Read-only is the script's contract; the fix is printed, never run. */
  it('changes nothing itself', () => {
    const out = report(['steading-api.service']);

    for (const line of out.split('|')) {
      if (line.startsWith('tip:')) continue;
      expect(line).not.toMatch(/^(ok|FAIL): .*\brm\b/);
    }
  });
});

describe('a real failure standing beside them', () => {
  /**
   * The case the split is judged on. Filed under the rename it would read as
   * already understood — and this is the unit that reports a farm going
   * unbacked, so being dismissed is exactly the outcome that costs something.
   */
  it('is reported on its own, not swallowed by the leftovers', () => {
    const out = report([
      'steading-api.service',
      'homefarm-backup.service',
      'steading-deploy.service',
    ]);

    expect(out).toContain('FAIL: failed: homefarm-backup.service');
    expect(out).not.toContain('ok: no failed units');
    // And the leftovers are still said, in their own line rather than mixed in.
    expect(out).toContain('FAIL: left over from the rename');
    expect(out).not.toContain('FAIL: failed: steading-api.service');
  });

  it('needs no leftovers to report a failure', () => {
    const out = report(['homefarm-backup-check.service']);

    expect(out).toContain('FAIL: failed: homefarm-backup-check.service');
    expect(out).not.toContain('left over from the rename');
  });

  /**
   * A name that merely contains the old one is not one of the retired units.
   * `steading` matched anywhere would file a farm's own service under the
   * rename — the same misfiling as above, arriving through the pattern instead
   * of through the list.
   */
  it('matches the prefix rather than the word', () => {
    const out = report(['homefarm-steading-shim.service']);

    expect(out).toContain('FAIL: failed: homefarm-steading-shim.service');
    expect(out).not.toContain('left over from the rename');
  });
});
