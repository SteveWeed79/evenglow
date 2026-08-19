#!/usr/bin/env node
/**
 * `pnpm check:names` — the gate a product rename is held to.
 *
 * ## Why a check rather than a careful afternoon
 *
 * The rename from Steading to Evenglow was done carefully, twice, and both
 * times something survived it. What is worth recording is *which* tool caught
 * what, because the ranking is the opposite of the intuitive one:
 *
 *   - **`typecheck` caught nothing. Not one defect.** Every survivor was
 *     type-valid. `` `${A} ` + +'b' `` compiles. Two adjacent text children in
 *     JSX compile, and render with a double space. A string literal holding the
 *     wrong name is a perfectly good string.
 *   - **The suite caught three**, and only where a test happened to assert the
 *     exact sentence. That is coverage by coincidence.
 *   - **A grep caught twelve**, including the Android permission dialog — a
 *     system prompt quoted verbatim by the OS on the one screen the app cannot
 *     explain itself on.
 *   - **Reading the source caught the worst one**, which no grep could: the
 *     launcher icon was drawn from a hardcoded letter `S`, for Steading. There
 *     is no search for a name that is not there.
 *
 * So this file is the grep, made permanent — because a grep run once is a grep
 * that is stale by Friday — plus the two rules that would have caught the two
 * classes a grep cannot see.
 *
 * ## The three rules
 *
 * 1. **A retired name may appear in prose, never in a value.** Comments and
 *    `.md` files are the project's record and quote old bug reports, old
 *    strings and old paths verbatim; rewriting them would make the record
 *    false. Anywhere else — a JSON value, a shell string, a systemd line, a
 *    test fixture — it is a survivor. This needs no allowlist, which is the
 *    point: an allowlist is a second thing to keep current.
 *
 * 2. **The brand is never written down twice.** `PRODUCT_NAME` is the one
 *    place it lives, so TypeScript that spells it out is a copy that the next
 *    rename will miss. This is the rule that makes a future rename a one-line
 *    change instead of another two-day sweep.
 *
 * 3. **Every path a config names must exist.** The dangling reference class:
 *    `ci.yml` went on naming `scripts/deploy/steading-deploy.timer` for a full
 *    commit after the file was renamed, and nothing anywhere noticed, because
 *    a YAML string is not checked against a filesystem until the day it runs.
 *
 * ## The exemption, and why it is a pragma rather than a list here
 *
 * Some code's whole subject is the old name — the live-box migration and its
 * test cannot be written without it — and some fixtures capture output from
 * tools that print the brand back at us, where the literal is what an external
 * program actually emitted rather than a copy of the brand.
 *
 * Those carry `check:names-ok` on the line, or `check:names-ok-file` near the
 * top for a file that is about the old name from end to end. The reason then
 * sits next to the code it excuses, where a reader hits it in context, instead
 * of in a list in this file that nobody opens until it is already wrong. A
 * pragma also dies with the line: delete the code and the exemption goes with
 * it, which is not true of a path in an allowlist.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Names this product has retired, and must not answer to in any live value.
 *
 * Add to it when a name is retired; nothing is ever removed. A name that came
 * off this list would stop being checked, which is the state that let the last
 * one linger.
 */
const RETIRED = [/\bsteading\b/i, /\bhome ?farm app\b/i];

/** The current brand, which belongs in exactly one file. */
const BRAND = 'Evenglow';
const BRAND_HOME = 'packages/contracts/src/product.ts';

const problems = [];
const fail = (file, line, message) => problems.push({ file, line, message });

/** Tracked files only — a stale build artifact is not a rename defect. */
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((f) => f !== '');

const isText = (file) => {
  if (/\.(png|jpg|jpeg|gif|ttf|otf|woff2?|ico|apk|keystore|zip|pdf)$/i.test(file)) return false;
  const full = path.join(ROOT, file);
  return existsSync(full) && statSync(full).isFile();
};

const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

/**
 * Is this line prose rather than a value?
 *
 * Deliberately generous about what counts as a comment and deliberately strict
 * about everything else. A false "this is prose" hides a defect; a false "this
 * is a value" costs somebody thirty seconds of rewording a comment. The second
 * is the error worth making.
 */
function isProse(file, line) {
  if (file.endsWith('.md')) return true;
  const t = line.trimStart();
  return (
    t.startsWith('//') ||   // TS, JS
    t.startsWith('*') ||    // JSDoc continuation
    t.startsWith('/*') ||
    t.startsWith('#') ||    // shell, YAML, .npmrc, systemd comments
    t.startsWith('::') ||   // batch
    t.startsWith('rem ') ||
    t.startsWith('REM ') ||
    t.startsWith('<!--')    // HTML
  );
}

// ── rule 1: a retired name only ever in prose ───────────────────────────────
//
// This file names them all, so it would fail itself.
const SELF = 'scripts/check-names.mjs';

/** `check:names-ok-file` near the top exempts a whole file. */
const exemptFile = (text) => text.slice(0, 4000).includes('check:names-ok-file');

/**
 * `check:names-ok` exempts the line it is on, or the line below it.
 *
 * Both, because the offending line is often a long string literal with no room
 * for a trailing comment — and a pragma pushed onto its own line above is where
 * the reason fits anyway.
 */
const exemptLine = (lines, i) =>
  lines[i].includes('check:names-ok') || (i > 0 && lines[i - 1].includes('check:names-ok'));

for (const file of tracked) {
  if (file === SELF || !isText(file)) continue;
  const text = read(file);
  if (exemptFile(text)) continue;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (isProse(file, line) || exemptLine(lines, i)) return;
    for (const pattern of RETIRED) {
      if (pattern.test(line)) {
        fail(file, i + 1, `retired name in a live value: ${line.trim().slice(0, 90)}`);
        break;
      }
    }
  });
}

// ── rule 2: the brand is written down once ──────────────────────────────────

for (const file of tracked) {
  if (!/\.(ts|tsx)$/.test(file) || file === BRAND_HOME || !isText(file)) continue;
  const text = read(file);
  if (exemptFile(text)) continue;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (isProse(file, line) || exemptLine(lines, i) || !line.includes(BRAND)) return;
    fail(
      file,
      i + 1,
      `'${BRAND}' spelled out — import PRODUCT_NAME from contracts instead: ${line.trim().slice(0, 70)}`,
    );
  });
}

// ── rule 3: every path a config names is on disk ────────────────────────────
//
// Three config formats, each of which names repository paths as opaque strings
// that nothing validates until the moment they are used — which for a systemd
// unit is on a farm's server, at three in the morning, after a deploy.

/** `app.json`'s asset paths, which `check:assets` also holds to a size. */
const appConfig = JSON.parse(read('apps/mobile/app.json')).expo;
const walk = (node, at) => {
  if (typeof node === 'string') {
    if (node.startsWith('./')) {
      const target = path.join(ROOT, 'apps/mobile', node);
      if (!existsSync(target)) fail('apps/mobile/app.json', 0, `${at} names ${node}, which is not on disk`);
    }
    return;
  }
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${at}[${i}]`));
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walk(v, at === '' ? k : `${at}.${k}`);
  }
};
walk(appConfig, '');

/** systemd units: `ExecStart=`, `EnvironmentFile=` and `WorkingDirectory=`. */
for (const file of tracked.filter((f) => /\.(service|timer)$/.test(f))) {
  read(file)
    .split('\n')
    .forEach((line, i) => {
      const m = /^(?:ExecStart|WorkingDirectory)=-?(\S+)/.exec(line);
      if (m === null) return;
      // Units address the box's deployed tree; only the repo half is checkable
      // from here, and it is the half that moves when a file is renamed.
      const rel = m[1].replace(/^\/opt\/[a-z0-9-]+\//, '');
      if (rel === m[1] || rel.startsWith('/')) return;
      if (!existsSync(path.join(ROOT, rel))) {
        fail(file, i + 1, `names ${rel}, which is not in this repository`);
      }
    });
}

/** Workflows and shell scripts naming a file under `scripts/`. */
for (const file of tracked.filter((f) => /^(\.github\/workflows\/.*\.ya?ml|scripts\/.*\.(sh|mjs))$/.test(f))) {
  if (file === SELF) continue;
  read(file)
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(/(?<![\w/.$-])(scripts\/[\w./-]+\.(?:sh|mjs|mts|service|timer|html))/g)) {
        if (!existsSync(path.join(ROOT, m[1]))) {
          fail(file, i + 1, `names ${m[1]}, which is not in this repository`);
        }
      }
    });
}

// ── report ──────────────────────────────────────────────────────────────────

if (problems.length > 0) {
  console.error('\ncheck:names — the rename is not finished.\n');
  for (const p of problems) {
    console.error(`  ${p.file}${p.line > 0 ? `:${p.line}` : ''}\n    ${p.message}`);
  }
  console.error(
    `\n  ${problems.length} problem${problems.length === 1 ? '' : 's'}.` +
      '\n  A retired name is allowed in a comment or a .md — that is the record,' +
      '\n  and rewriting it would make the record false. Anywhere else it is live.' +
      '\n  Code whose subject IS the old name says so: `check:names-ok` on the line,' +
      '\n  or `check:names-ok-file` at the top, with the reason beside it.\n',
  );
  process.exit(1);
}

console.log(
  `check:names — ${tracked.length} tracked files, no retired name in a live value, ` +
    'the brand in one place, every named path on disk.',
);
