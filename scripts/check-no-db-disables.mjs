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

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|mts)$/.test(path)) yield path;
  }
}

const failures = [];

for (const file of walk('src')) {
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

console.log('No inline disables of the database guard rules.');
