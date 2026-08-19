import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
