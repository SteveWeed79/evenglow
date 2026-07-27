#!/usr/bin/env node
/**
 * CLAUDE.md invariant 1: the db guard rules may not be disabled inline.
 *
 * ESLint cannot enforce this on itself — an eslint-disable silences the very
 * rule that would report it — so it is checked separately.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GUARDED_RULES = ['no-restricted-syntax', 'no-restricted-imports'];
const DISABLE = /eslint-disable(?:-next-line|-line)?\s+([^\n*]+)/g;

/**
 * Roots holding first-party source. Listed rather than inferred so that moving
 * the tree without updating this file is a loud failure — see the scanned-count
 * assertion below.
 */
const SOURCE_ROOTS = ['src', 'packages', 'apps'];

/**
 * Skipped wholesale. `node_modules` matters most: pnpm links dependencies into
 * each workspace package, and statSync follows those links, so a naive walk
 * descends into the entire dependency tree and reports disables in code we do
 * not own.
 */
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|mts)$/.test(path)) yield path;
  }
}

const failures = [];

/**
 * A guard pointed at a directory that no longer exists reports success and
 * enforces nothing. That is not hypothetical here: a restructure moved src/ to
 * apps/ and packages/ and left every check in this repo aimed at the old path,
 * which would have silently disarmed rubric C1. Scanning zero files is
 * therefore a failure, not a pass.
 */
const roots = SOURCE_ROOTS.filter((root) => {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
});

if (roots.length === 0) {
  console.error(
    `\nNo source root found. Looked for: ${SOURCE_ROOTS.join(', ')}.\n` +
      'If the tree moved, update SOURCE_ROOTS in this script — the guard is\n' +
      'not optional, and a check that scans nothing is worse than no check.\n',
  );
  process.exit(1);
}

let scanned = 0;
for (const file of roots.flatMap((root) => [...walk(root)])) {
  scanned++;
  const contents = readFileSync(file, 'utf8');
  for (const match of contents.matchAll(DISABLE)) {
    const rules = match[1];
    for (const rule of GUARDED_RULES) {
      // A bare `eslint-disable` with no rule list silences everything.
      if (rules.includes(rule) || rules.trim() === '') {
        failures.push(`${file}: disables "${rule.trim()}"`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('\nThe database guard rules may not be disabled inline:\n');
  for (const failure of failures) console.error(`  • ${failure}`);
  console.error('\nUse scoped(orgId).col() instead of working around the guard.\n');
  process.exit(1);
}

console.log(`No inline disables of the database guard rules (${scanned} files scanned).`);
