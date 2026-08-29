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

/**
 * The account, on a re-run against a different database.
 *
 * `setup-mongo.sh` decides whether to create the application account by
 * counting users named `homefarm` — and the roles that account holds are
 * granted **per database**, at creation. So a re-run with a different
 * `MONGODB_DB` took the "already exists" branch, said so, and left the account
 * with `readWrite` on the old database only.
 *
 * What that produces is not a box that fails to start. The API connects,
 * authenticates against `admin` perfectly well, and then every query comes back
 * `not authorized on <db>` — a box that provisioned cleanly, reported success,
 * and cannot read or write one record.
 *
 * Asserted against the source, like everything else in this file: the failure
 * needs a live mongod, a first run, and a second run with a changed name.
 */
describe('setup-mongo.sh on a box whose database name has changed', () => {
  const source = executable(read('setup-mongo.sh'));

  it('asks whether the account can reach THIS database, not only whether it exists', () => {
    // The existence check is what was there; on its own it is the defect.
    expect(source).toContain('countDocuments({user:"homefarm"})');
    // And the second question, which decides the branch that was missing.
    expect(source).toContain("r.db === '${DB_NAME}'");
  });

  it('grants the roles when it holds none there', () => {
    expect(source).toContain('grantRolesToUser');
    expect(source).toContain("{ role: 'readWrite', db: '${DB_NAME}' }");
    expect(source).toContain("{ role: 'dbAdmin',   db: '${DB_NAME}' }");
  });

  /**
   * Inside the auth-disabled window, which is the only place the command is
   * permitted — and before the window is closed and verified, so a grant that
   * fails cannot leave authorization off.
   */
  it('grants inside the window the trap protects', () => {
    const opened = source.indexOf('AUTH_WINDOW_OPEN=1');
    const granted = source.indexOf('grantRolesToUser');
    // The LAST one: the flag is initialised to 0 at the top so the trap can be
    // armed before the window opens, and it is the closing assignment that has
    // to come after the grant.
    const closed = source.lastIndexOf('AUTH_WINDOW_OPEN=0');

    expect(opened).toBeGreaterThan(0);
    expect(granted).toBeGreaterThan(opened);
    expect(closed).toBeGreaterThan(granted);
  });
});


/**
 * The two ways a build reached — or failed to reach — a farm's phone.
 *
 * ## An APK nobody checked
 *
 * `publish-apk.sh` establishes two things about a file before it goes on the
 * shelf: that it is an APK at all, and that it is **our** application. Both
 * checks sat inside `if command -v unzip`, and nothing installed `unzip`. So on
 * the ordinary box neither ran, the only surviving test was the four magic bytes
 * that say "this is a zip", and any zip named `.apk` was published as the farm's
 * app — the exact failure that file records as *"found by publishing this
 * repository's README as a build"*, reinstated by the absence of a package.
 *
 * ## A release with nothing on it
 *
 * `gh release create <tag> <file>` creates the release and then uploads. An
 * upload that fails afterwards leaves the release behind, empty — and the
 * collision guard then refused that tag for ever, so the box serving that commit
 * never got an app and every later run failed against a release holding nothing.
 */
describe('what reaches a phone', () => {
  const publish = executable(read('publish-apk.sh'));

  it('refuses to publish a build it cannot check, rather than skipping the check', () => {
    // The defect is the conditional. Both checks are unconditional now, and the
    // absence of the tool is its own refusal.
    expect(publish).not.toContain('if command -v unzip');
    expect(publish).toContain('Refusing to publish an unverified build');
    expect(publish).toContain('AndroidManifest.xml');
    expect(publish).toContain('$EXPECT_APP_ID');
  });

  /** So the refusal is something a box built by these scripts never meets. */
  it('installs unzip in setup-box.sh, unconditionally', () => {
    const setup = executable(read('setup-box.sh'));
    expect(setup).toContain('apt-get install -y unzip');

    // Before the Node block, which is where the other base packages are — and
    // which only runs on a box that needed Node.
    expect(setup.indexOf('apt-get install -y unzip')).toBeLessThan(
      setup.indexOf('apt-get install -y nodejs'),
    );
  });

  it('counts the APKs on a release rather than only whether one exists', () => {
    const workflow = readFileSync(
      join(__dirname, '..', '..', '.github', 'workflows', 'apk.yml'),
      'utf8',
    );

    expect(workflow).toContain("select(.name | endswith(\".apk\"))");
    // An empty release is the wreckage of a failed upload, not a collision, so
    // filling it is the repair.
    expect(workflow).toContain('gh release upload');
    expect(workflow).toContain('a previous upload did not finish');
    // And a run that produces the empty state itself clears it, so the tag is
    // free rather than blocked for ever.
    expect(workflow).toContain('so the tag is free to retry');
  });

  /**
   * The git tag goes only when this run made the release. One that was already
   * there belongs to whoever made it, and `deploy.sh` resolves a commit to a tag
   * with git before it asks GitHub anything.
   */
  it('does not delete a tag it did not create', () => {
    const workflow = readFileSync(
      join(__dirname, '..', '..', '.github', 'workflows', 'apk.yml'),
      'utf8',
    );

    const cleanup = workflow.indexOf('--cleanup-tag');
    const guard = workflow.indexOf('if [ "$CREATED" = "1" ]; then');

    expect(guard).toBeGreaterThan(0);
    expect(cleanup).toBeGreaterThan(guard);
  });
});
