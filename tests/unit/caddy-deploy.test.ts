import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What a deploy is allowed to do to a box's web server config.
 *
 * `deploy.sh` renders `/etc/caddy/Caddyfile` from the repository and installs it
 * over the running one **every five minutes**. That is deliberate and load
 * bearing — a Caddyfile only `setup-box.sh` ever installed went stale the day
 * `/app` was added, and the box answered 404 for a route Caddy was meant to
 * serve.
 *
 * The cost was paid by anything an operator added by hand. `DEPLOY-THE-SERVER.md`
 * told them to append an `ops.example.com` block for the operations board, and:
 *
 * - **appended**, the block was deleted within five minutes, with
 *   `reloaded for <domain>` as the only trace;
 * - **prepended**, `head -1` read `ops.example.com` as the domain and the API's
 *   whole config was rendered for that name — every handset loses its server,
 *   reported as a successful reload.
 *
 * These assertions run the **actual decision block out of `deploy.sh`** against
 * fixture trees rather than restating it, because a test that restates a shell
 * script is a second copy of the bug. `sed` lifts the block by its own comment
 * heading, so a rewrite that drops the guard fails here rather than on a farm.
 */

const REPO = join(__dirname, '..', '..');
const DEPLOY = join(REPO, 'scripts', 'deploy', 'deploy.sh');
const TEMPLATE = join(REPO, 'scripts', 'deploy', 'Caddyfile');

/** Top-level site block names — the same expression the deploy itself uses. */
function siteBlocks(text: string): string[] {
  return text
    .split('\n')
    .map((line) => /^([a-z0-9.-]+) \{$/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

/**
 * Runs the deploy's Caddy decision against a fixture `/etc/caddy`, with the
 * side effects stubbed. Returns what it decided rather than what it printed.
 */
function decide(caddyfile: string): { notes: string; rendered: string | null; backup: boolean } {
  const root = mkdtempSync(join(tmpdir(), 'caddy-'));
  const etc = join(root, 'etc', 'caddy');
  mkdirSync(join(etc, 'conf.d'), { recursive: true });
  writeFileSync(join(etc, 'Caddyfile'), caddyfile);

  const block = execFileSync('sed', ['-n', '/Which name to render for/,/^  fi$/p', DEPLOY], {
    encoding: 'utf8',
  }).replaceAll('/etc/caddy', etc);

  const out = join(root, 'rendered');
  const script = [
    'set -u',
    `REPO_DIR=${JSON.stringify(REPO)}`,
    'NOTES=""',
    'note() { NOTES="$NOTES;$1"; }',
    // The three things the block does to the world, neutered.
    `install() { if [ "$1" = "-m" ]; then cp "$3" ${JSON.stringify(out)}; fi; }`,
    'systemctl() { :; }',
    'caddy() { return 0; }',
    block,
    'printf "%s" "$NOTES"',
  ].join('\n');

  const notes = execFileSync('bash', ['-c', script], { encoding: 'utf8' });

  return {
    notes,
    rendered: existsSync(out) ? (siteBlocks(readFileSync(out, 'utf8'))[0] ?? null) : null,
    backup: existsSync(join(etc, 'Caddyfile.local-blocks.bak')),
  };
}

const API_ONLY = 'import /etc/caddy/conf.d/*.caddy\n\napi.swbuild.dev {\n\treverse_proxy 127.0.0.1:3001\n}\n';
const OPS = 'ops.swbuild.dev {\n\treverse_proxy 127.0.0.1:3002\n}\n';

describe('the Caddyfile this repository ships', () => {
  /**
   * The whole scheme rests on it: one block means the deploy can always tell
   * which name is the API's, and a second one in the running file is therefore
   * unambiguously somebody's local addition.
   */
  it('owns exactly one site block', () => {
    expect(siteBlocks(readFileSync(TEMPLATE, 'utf8'))).toEqual(['api.example.com']);
  });

  /**
   * **Absolute, and this is not style.** Caddy resolves a relative import
   * against the file the import appears in, and `deploy.sh` validates a
   * rendered copy at `/tmp/Caddyfile.next` — so a relative path would look in
   * `/tmp` at validate time and `/etc/caddy` at serve time.
   */
  it('imports the local directory by absolute path', () => {
    expect(readFileSync(TEMPLATE, 'utf8')).toContain('import /etc/caddy/conf.d/*.caddy');
  });

  /**
   * Caddy's globbing includes dotfiles, unlike a shell's, so a bare `*` hands
   * it an editor's `.ops.caddy.swp`.
   */
  it('requires the .caddy suffix rather than globbing everything', () => {
    expect(readFileSync(TEMPLATE, 'utf8')).not.toContain('import /etc/caddy/conf.d/*\n');
  });

  it('is created by both the setup and the deploy, before anything validates it', () => {
    for (const script of ['setup-box.sh', 'deploy.sh']) {
      const text = readFileSync(join(REPO, 'scripts', 'deploy', script), 'utf8');
      expect(text, script).toContain('install -d -m 0755 /etc/caddy/conf.d');
    }
  });
});

describe('what a deploy does to a Caddyfile it did not write', () => {
  it('renders and reloads when the box has only the API block', () => {
    const result = decide(API_ONLY);

    expect(result.rendered).toBe('api.swbuild.dev');
    expect(result.notes).toContain('reloaded for api.swbuild.dev');
    expect(result.backup).toBe(false);
  });

  /** The block that used to vanish within five minutes. */
  it('leaves the file alone when a block was appended, and keeps a copy', () => {
    const result = decide(API_ONLY + '\n' + OPS);

    expect(result.rendered).toBeNull();
    expect(result.backup).toBe(true);
    expect(result.notes).toContain('will not guess');
  });

  /**
   * **The worse ordering.** `head -1` returned `ops.swbuild.dev`, so the API's
   * config was rendered for the board's hostname and the farm-facing name
   * stopped being served — announced as a successful reload.
   */
  it('never renders the API config for somebody elses hostname', () => {
    const result = decide(OPS + '\n' + API_ONLY);

    expect(result.rendered).not.toBe('ops.swbuild.dev');
    expect(result.rendered).toBeNull();
    expect(result.backup).toBe(true);
  });

  /** Both names are said out loud, so the note is actionable without a diff. */
  it('names the blocks it found', () => {
    const notes = decide(API_ONLY + '\n' + OPS).notes;

    expect(notes).toContain('api.swbuild.dev');
    expect(notes).toContain('ops.swbuild.dev');
    expect(notes).toContain('conf.d');
  });

  /**
   * The first copy is the one taken while the extra blocks were still there. A
   * second pass must not replace it — least of all with a copy of a file this
   * deploy has since rendered.
   */
  it('does not overwrite an existing backup on a later pass', () => {
    const root = mkdtempSync(join(tmpdir(), 'caddy-'));
    const etc = join(root, 'etc', 'caddy');
    mkdirSync(join(etc, 'conf.d'), { recursive: true });
    writeFileSync(join(etc, 'Caddyfile'), API_ONLY + '\n' + OPS);
    writeFileSync(join(etc, 'Caddyfile.local-blocks.bak'), 'the original\n');

    const block = execFileSync('sed', ['-n', '/Which name to render for/,/^  fi$/p', DEPLOY], {
      encoding: 'utf8',
    }).replaceAll('/etc/caddy', etc);

    execFileSync('bash', [
      '-c',
      ['set -u', `REPO_DIR=${JSON.stringify(REPO)}`, 'note() { :; }', 'install() { :; }', 'systemctl() { :; }', 'caddy() { return 0; }', block].join('\n'),
    ]);

    expect(readFileSync(join(etc, 'Caddyfile.local-blocks.bak'), 'utf8')).toBe('the original\n');
  });

  /**
   * A backup inside `conf.d` ending in `.caddy` would be imported, re-declaring
   * the API's own site block and leaving Caddy a config it refuses to load.
   */
  it('keeps the backup out of the imported directory', () => {
    const text = readFileSync(DEPLOY, 'utf8');
    expect(text).toContain('/etc/caddy/Caddyfile.local-blocks.bak');
    expect(text).not.toContain('conf.d/Caddyfile.local-blocks');
  });
});

/**
 * ── The ten days ──────────────────────────────────────────────────────────
 *
 * `/app/` answered 404 on the live box for ten days while every check said the
 * box was fine. The chain:
 *
 * 1. `setup-box.sh` created `/var/log/caddy` owned by caddy and **never the
 *    file inside it**, so the log belonged to whichever process wrote there
 *    first — root, running the rename by hand, at 0600.
 * 2. Caddy opens its log files as `caddy` when it loads a config, could not,
 *    and therefore **refused the whole config** and went on serving the one it
 *    had — a pre-rename one, rooted at a directory that no longer existed.
 * 3. `deploy.sh` rendered the correct Caddyfile, `cmp` found it identical to
 *    the correct file already on disk, and it printed `unchanged` and exited 0.
 *    Every five minutes. The repair could never be attempted because nothing
 *    had noticed anything to repair.
 * 4. `systemctl status caddy` said `active (running)`. `check-box.sh` said
 *    `ok caddy running`. `systemctl --failed` was empty.
 *
 * Four green signals, one 404, and the only place the truth existed was
 * Caddy's own admin API — which nothing asked. These assertions are the four
 * links, each closed.
 */

/** Lifts a block out of `deploy.sh` by its own comment heading. */
function lift(heading: string, end: string): string {
  return execFileSync('sed', ['-n', `/${heading}/,/${end}/p`, DEPLOY], { encoding: 'utf8' });
}

describe('the log file caddy has to be able to open', () => {
  function run(existing: string | null): { contents: string | null; mode: string } {
    const root = mkdtempSync(join(tmpdir(), 'caddylog-'));
    const dir = join(root, 'log', 'caddy');
    if (existing !== null) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'homefarm.log'), existing, { mode: 0o600 });
    }

    const block = lift('The log file, and the reload that was refused', '^  chown caddy:caddy').replaceAll(
      '/var/log/caddy',
      dir,
    );
    execFileSync('bash', ['-c', ['set -u', block].join('\n')]);

    const log = join(dir, 'homefarm.log');
    return {
      contents: existsSync(log) ? readFileSync(log, 'utf8') : null,
      mode: (statSync(log).mode & 0o777).toString(8),
    };
  }

  /** Link 1: the file nothing ever created. */
  it('creates it when it is absent', () => {
    expect(run(null).contents).toBe('');
  });

  /**
   * **Never `install /dev/null`.** The log is the only record of when the box
   * broke, and this runs every five minutes — a truncating repair would erase
   * the evidence of the failure it was written to fix, on the first tick after
   * anybody noticed.
   */
  it('never truncates a log that is already there', () => {
    expect(run('a request from august\n').contents).toBe('a request from august\n');
  });

  /**
   * The case this exists for is a file that is already present and unopenable,
   * so the mode and ownership are corrected on an existing file too — creating
   * it correctly and then leaving a wrong one alone would fix nothing.
   */
  it('corrects the mode of a file it did not create', () => {
    expect(run('older\n').mode).toBe('644');
  });

  /** Link 1, on a box that will never run the setup script again. */
  it('is repaired by the deploy as well as the setup, not only the setup', () => {
    for (const script of ['setup-box.sh', 'deploy.sh']) {
      const text = readFileSync(join(REPO, 'scripts', 'deploy', script), 'utf8');
      expect(text, script).toContain('chown caddy:caddy /var/log/caddy /var/log/caddy/homefarm.log');
    }
  });
});

describe('what the deploy believes about a reload', () => {
  /**
   * Runs the running-config check with `curl` answering from a script. Each
   * entry is one line of admin-API output; an empty string is an admin API
   * that did not answer.
   */
  function verify(replies: string[], blocks = 1): { notes: string[]; wrong: boolean; reloaded: boolean } {
    const root = mkdtempSync(join(tmpdir(), 'caddyrun-'));
    const file = join(root, 'replies');
    writeFileSync(file, replies.map((r) => r + '\n').join(''));

    const script = [
      'set -u',
      'CADDY_WRONG=0',
      // What the render decision above leaves behind: how many site blocks the
      // running Caddyfile has, and which name this deploy rendered for.
      `COUNT=${blocks}`,
      `DOMAIN=${blocks === 1 ? 'api.swbuild.dev' : '""'}`,
      `REPLIES=${JSON.stringify(file)}`,
      'NOTES=""',
      'RELOADED=0',
      'note() { NOTES="$NOTES;$1"; }',
      // Pops one scripted answer per call. A file rather than a variable
      // because the block calls curl inside a command substitution.
      'curl() { head -1 "$REPLIES"; tail -n +2 "$REPLIES" > "$REPLIES.tmp"; mv "$REPLIES.tmp" "$REPLIES"; }',
      'systemctl() { RELOADED=1; }',
      'sleep() { :; }',
      lift('What is actually running', '^  fi$'),
      'printf "%s\\n%s\\n%s" "$CADDY_WRONG" "$RELOADED" "$NOTES"',
    ].join('\n');

    const [wrong, reloaded, notes] = execFileSync('bash', ['-c', script], { encoding: 'utf8' }).split('\n');
    return { notes: (notes ?? '').split(';').filter(Boolean), wrong: wrong === '1', reloaded: reloaded === '1' };
  }

  const GOOD = '{"apps":{"http":{"servers":{"srv0":{"routes":[{"handle":[{"root":"/var/lib/homefarm/dist"}]}]}}}}}';
  const STALE = '{"apps":{"http":{"servers":{"srv0":{"routes":[{"handle":[{"root":"/var/lib/steading/dist"}]}]}}}}}'; // check:names-ok-file

  /** Link 4: the one signal that was telling the truth, now consulted. */
  it('passes when the running config serves the directory on disk', () => {
    const result = verify([GOOD]);

    expect(result.wrong).toBe(false);
    expect(result.reloaded).toBe(false);
  });

  /**
   * Link 3. The whole config on the box was a rename behind, and this is the
   * shape the admin API showed it in.
   */
  it('catches a running config rooted somewhere the deploy never wrote', () => {
    const result = verify([STALE, STALE]);

    expect(result.wrong).toBe(true);
    expect(result.notes.join(' ')).toContain('NOT THE ONE ON DISK');
  });

  /**
   * **The self-heal, and the reason it is not optional.** The repair above
   * lands on disk, `cmp` then says the Caddyfile is unchanged, and nothing ever
   * asks Caddy to read it again. Without this retry the box would have gone on
   * serving the stale config after the fix as well as before it.
   */
  it('reloads once and accepts the result when that fixed it', () => {
    const result = verify([STALE, GOOD]);

    expect(result.reloaded).toBe(true);
    expect(result.wrong).toBe(false);
    expect(result.notes.join(' ')).toContain('taken it now');
  });

  /**
   * A box that answers nothing on 2019 has moved or disabled the admin
   * endpoint, which is a choice rather than a fault. Asserting a failure there
   * would make this check something an operator learns to ignore.
   */
  it('says so rather than failing when the admin API is not there', () => {
    const result = verify(['']);

    expect(result.wrong).toBe(false);
    expect(result.notes.join(' ')).toContain('did not answer');
  });

  /**
   * Link 3, and the reason the check sits outside the render decision: the
   * `unchanged` path is exactly the state a refused reload leaves behind, and a
   * deploy that looks only when it changed something can never find this.
   */
  it('runs on every tick, not only when the Caddyfile changed', () => {
    const text = readFileSync(DEPLOY, 'utf8');
    const check = text.indexOf('What is actually running');
    const unchanged = text.indexOf('note "unchanged"');

    expect(check).toBeGreaterThan(unchanged);
    expect(text.slice(unchanged, check)).toContain('  fi\n');
  });

  /**
   * **But it stops at the boundary the render decision drew.** On a box that
   * predates `conf.d` the deploy deliberately leaves the Caddyfile alone, so
   * the running config is somebody else's — and a config this script has
   * already decided not to touch must not become a failure it reports every
   * five minutes for ever. The multi-block note is the loud part there, and it
   * is actionable; this would only be noise on top of it.
   */
  it('says nothing about a Caddyfile the deploy refused to render', () => {
    const result = verify([STALE, STALE], 2);

    expect(result.wrong).toBe(false);
    expect(result.reloaded).toBe(false);
    expect(result.notes).toEqual([]);
  });

  /**
   * **And it is not a successful deploy.** Exiting 0 with the web server
   * serving something else is what kept `systemctl --failed` empty for ten
   * days. Checked at the exit rather than where it is found, so the API
   * restart is never skipped for it.
   */
  it('makes the deploy exit non-zero, after the API is back up', () => {
    const text = readFileSync(DEPLOY, 'utf8');
    const flag = text.indexOf('CADDY_WRONG=0');
    const guard = text.indexOf('if [ "$CADDY_WRONG" -eq 1 ]; then');

    expect(flag).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(text.indexOf('systemctl restart homefarm-api'));
    expect(text.slice(guard)).toContain('exit 1');
  });
});

describe('what check-box.sh looks at', () => {
  const CHECK = readFileSync(join(REPO, 'scripts', 'deploy', 'check-box.sh'), 'utf8');

  /**
   * Link 4. Its own header says every failure this box has had "looked like
   * nothing at all" — and then it reported `ok caddy running` about a Caddy
   * that had refused its config ten days earlier.
   */
  it('asks which config is live, not only whether the process is up', () => {
    expect(CHECK).toContain('127.0.0.1:2019/config/');
    expect(CHECK).toContain('NOT THE ONE ON DISK');
  });

  /** The cause, so the repair does not need a journal to find. */
  it('checks that caddy owns the log file it has to open', () => {
    expect(CHECK).toContain('/var/log/caddy/$NEW.log');
    expect(CHECK).toContain('EVERY reload is refused');
  });

  /**
   * The one thing a person actually asked about — *"I still cannot access the
   * download"* — and the script whose purpose is catching what is silent when
   * it breaks did not fetch it.
   */
  it('fetches /app/ over the real name', () => {
    expect(CHECK).toContain('/app/');
    expect(CHECK).toContain('https://$d/app/');
  });

  /**
   * A box cannot always reach its own public name from the inside, so an
   * unreachable name is a note. A 404 is not: that is the failure this exists
   * for, and softening it would put it straight back where it was.
   */
  it('treats unreachable as a note and a bad status as a failure', () => {
    const section = CHECK.slice(CHECK.indexOf('The thing somebody is actually sent to'));

    expect(section).toContain('HM "could not reach any site\'s /app/');
    expect(section).toContain('NO "/app/ is not being served');
  });
});
