import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Three properties of the deploy scripts that were each false, each silently,
 * and each cost a farm something before anybody noticed.
 *
 * They are asserted against the source rather than by running anything, because
 * every one of them only manifests on a live box: a unit that is never
 * installed, a flag that needs a topology this project does not build, and a
 * settings file read one line too late. A test that needed a box to fail is a
 * test that would have been written after the outage rather than instead of it.
 */

const DEPLOY = join(__dirname, '..', '..', 'scripts', 'deploy');
const read = (name: string): string => readFileSync(join(DEPLOY, name), 'utf8');

/** Executable lines only. A verb in a comment is not an invocation. */
const executable = (source: string): string =>
  source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

describe('setup-box.sh installs what a farm depends on', () => {
  /**
   * The failure this replaces: `setup-box.sh` mentioned backups **nowhere**.
   * The four units were a manual copy in the middle of a deployment document,
   * so the documented build produced a box with no off-box copy of a farm's
   * records — and, because the checker is one of the four, no alarm either.
   * `systemctl --failed` stayed clean, and a box with no backups looked exactly
   * like a working one.
   */
  it('installs every backup unit that exists in the directory', () => {
    const setup = read('setup-box.sh');
    const backupUnits = readdirSync(DEPLOY).filter(
      (f) => f.startsWith('homefarm-backup') && (f.endsWith('.service') || f.endsWith('.timer')),
    );

    expect(backupUnits.length).toBeGreaterThan(0);
    for (const unit of backupUnits) {
      expect({ unit, installed: setup.includes(unit) }).toEqual({ unit, installed: true });
    }
  });

  /**
   * Enabled before `backup.env` exists and before the timer beside it starts,
   * which is the point: with no marker `check-backup.sh` says "No backup has
   * ever completed on this box" and prints the command that fixes it. That is
   * the true state of a freshly built box, and the one thing the old
   * arrangement could never say.
   */
  it('enables the checker, so an absent backup is reported rather than silent', () => {
    expect(executable(read('setup-box.sh'))).toContain(
      'systemctl enable --now homefarm-backup-check.timer',
    );
  });

  /**
   * The ops board is the one unit deliberately NOT installed here — it reads
   * every farm on the box, so it is opt-in. Asserted so the rule above cannot
   * later be widened into "install everything" by someone tidying up.
   */
  it('leaves the ops board alone, which is deliberate', () => {
    expect(executable(read('setup-box.sh'))).not.toContain('homefarm-ops.service');
  });
});

describe('the backup can actually run against the database this repo builds', () => {
  /**
   * `--oplog` needs a replica-set member; `setup-mongo.sh` installs a standalone
   * and argues the case for it. It also reads `local.oplog.rs`, and the account
   * that script creates holds no role on `local`. And it is refused outright
   * when the target names one database, which every box's URI does.
   *
   * So the flag could never work here, and its presence meant `mongodump` exited
   * non-zero and no archive was ever written — nightly, with the timer that
   * would have said so installed by a step nobody ran.
   */
  it('passes no --oplog, which a standalone cannot serve', () => {
    const backup = executable(readFileSync(join(DEPLOY, '..', 'backup-mongo.sh'), 'utf8'));
    expect(backup).toContain('mongodump');
    expect(backup).not.toContain('--oplog');
    // The other half: an archive with no oplog cannot be replayed with one.
    expect(backup).not.toContain('--oplogReplay');
  });

  /** If a replica set is ever introduced, this is the line that has to change first. */
  it('setup-mongo.sh still builds a standalone, so the above stays true', () => {
    expect(executable(read('setup-mongo.sh'))).not.toContain('replSetName');
  });
});

describe('the auth-disabled window cannot outlive the script', () => {
  /**
   * `setup-mongo.sh` turns MongoDB's authorization OFF, creates the account,
   * and turns it back on. It had no `trap`, so any death inside that window —
   * a failed restart, a duplicate-user race, or a dropped SSH session, which
   * this is documented as being run over and which the window's 30s of `sleep`
   * makes easy to hit — left `authorization: disabled` on disk with `mongod`
   * enabled. The database then came back unauthenticated on every subsequent
   * reboot, indefinitely, with nothing saying so.
   */
  it('arms a trap before disabling, and clears it only after verifying', () => {
    const source = executable(read('setup-mongo.sh'));

    const armed = source.indexOf('trap restore_auth EXIT INT TERM HUP');
    const disabled = source.indexOf('write_conf disabled');
    const cleared = source.indexOf('trap - EXIT INT TERM HUP');
    const verified = source.indexOf('unauthenticated read succeeded');

    expect(armed).toBeGreaterThan(0);
    // Armed before the window opens, or the window can open unprotected.
    expect(armed).toBeLessThan(disabled);
    // Released only after the check that proves the lock is back on.
    expect(cleared).toBeGreaterThan(verified);
  });

  /**
   * The other half: the verification `die`d only when the unauthenticated read
   * SUCCEEDED, so a mongod that never came back was read as proof of
   * enforcement and the script exited 0 reporting a locked database that
   * nothing could reach.
   */
  it('separates "locked" from "unreachable" before claiming either', () => {
    const source = executable(read('setup-mongo.sh'));
    const ping = source.indexOf('mongod is not answering after the restart');
    const locked = source.indexOf('Authorization is NOT in force');

    expect(ping).toBeGreaterThan(0);
    // Reachability is established first; only then is the refusal meaningful.
    expect(ping).toBeLessThan(locked);
  });

  /** And a ping that never answers is a failure, not a fall-through to success. */
  it('refuses a mongod that is active but not answering', () => {
    expect(executable(read('setup-mongo.sh'))).toContain(
      'has not answered a ping in 15s',
    );
  });
});

describe('deploy.sh can be pointed at the checkout it actually lives in', () => {
  /**
   * `deploy.env` was sourced thirteen lines below `REPO_DIR`, so the two
   * settings that decide where the script works could never be overridden —
   * while `HOMEFARM_REF` and `HOMEFARM_APP_ID`, read after it, could.
   *
   * The unit carries no `EnvironmentFile=`, so that source is the only channel
   * there is. A box at another path therefore invoked its own copy of this
   * script, which looked somewhere else, died, and failed every five minutes
   * for ever — unable to deploy, and so unable to receive the fix for its own
   * condition.
   */
  it('sources deploy.env before it reads anything that file could set', () => {
    const source = executable(read('deploy.sh'));

    const sourced = source.indexOf('. /etc/homefarm/deploy.env');
    expect(sourced).toBeGreaterThan(0);

    for (const setting of ['HOMEFARM_DIR', 'PORT:-', 'HOMEFARM_REF', 'HOMEFARM_APP_ID']) {
      const at = source.indexOf(setting);
      expect({ setting, readAfterTheFileIsSourced: at > sourced }).toEqual({
        setting,
        readAfterTheFileIsSourced: true,
      });
    }
  });

  /** And with nothing set at all, it finds the tree it is running out of. */
  it('defaults to its own checkout rather than a hardcoded path', () => {
    expect(executable(read('deploy.sh'))).toContain('BASH_SOURCE');
  });
});
