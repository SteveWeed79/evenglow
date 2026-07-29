#!/usr/bin/env node
/**
 * `pnpm check:icons` — the gate the icon set is held to, in the same spirit as
 * check:secrets and check:no-db-disables: a rule that is cheap to state and
 * impossible to forget, because CI fails without it.
 *
 * Adapted from the design handoff's check, which reads the web sprite. This
 * one reads `apps/mobile/src/components/Icon.tsx`, because on React Native
 * there is no sprite at all — react-native-svg has no cross-document `<use>`,
 * so drawings travel as data. The rules are the same rules; only the thing
 * being parsed changed.
 *
 * What it proves, on every build:
 *   1. Parity      — every manifest icon has both masters, and the module
 *                    carries nothing the manifest does not name.
 *   2. Budget      — no drawing exceeds four elements.
 *   3. Inheritance — no literal colour anywhere in the marks, so one set can
 *                    serve daylight, lamplight and bright sun.
 *   4. References  — every name used in app source exists in the set.
 *
 * Limitation, stated rather than hidden: geometry is NOT re-verified here.
 * Margins and centreline snapping are properties of the drawings, and the
 * drawings are generated upstream from the v3 sheet. This check guards the
 * boundary — that the module and the manifest agree, and that the app only
 * asks for marks that exist. If the drawings themselves need re-checking, that
 * belongs upstream where the sheet is.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODULE = path.join(ROOT, 'apps/mobile/src/components/Icon.tsx');
const MANIFEST = path.join(ROOT, 'apps/mobile/src/components/icons.manifest.json');
const SOURCE = path.join(ROOT, 'apps/mobile/src');

const problems = [];
const fail = (message) => problems.push(message);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const source = readFileSync(MODULE, 'utf8');

// ── parse the MARKS table ───────────────────────────────────────────────────

/**
 * Deliberately a parse of the literal rather than an import.
 *
 * Importing would need the TS toolchain and would happily accept a file that
 * builds its table at runtime — which is exactly the change that would let the
 * set drift without any of these rules noticing.
 */
const table = source.slice(source.indexOf('const MARKS'), source.indexOf('export const SMALL_MASTER_MAX'));

const entries = new Map();
const entryPattern = /'([a-z-]+)':\s*\{\s*32:\s*\[([\s\S]*?)\],\s*24:\s*\[([\s\S]*?)\],\s*\}/g;

for (const [, name, big, small] of table.matchAll(entryPattern)) {
  entries.set(name, { 32: big, 24: small });
}

if (entries.size === 0) fail('Could not parse the MARKS table — the shape of Icon.tsx changed.');

// ── 1. parity ───────────────────────────────────────────────────────────────

const named = new Set(manifest.icons.map((icon) => icon.name));

for (const icon of manifest.icons) {
  if (!entries.has(icon.name)) fail(`Manifest names "${icon.name}" and Icon.tsx has no mark for it.`);
}
for (const name of entries.keys()) {
  if (!named.has(name)) fail(`Icon.tsx draws "${name}", which the manifest does not name.`);
}

// ── 2. budget ───────────────────────────────────────────────────────────────

/** Elements are one array item each: ['P', …], ['C', …], ['E', …], ['R', …]. */
const countElements = (body) => (body.match(/\['[PCER]'/g) ?? []).length;

for (const [name, masters] of entries) {
  for (const master of [32, 24]) {
    const count = countElements(masters[master]);
    if (count === 0) fail(`"${name}" has an empty ${master}-unit master.`);
    if (count > manifest.maxElements) {
      fail(`"${name}" (${master}) draws ${count} elements; the budget is ${manifest.maxElements}.`);
    }
  }
}

// ── 3. inheritance ──────────────────────────────────────────────────────────

/**
 * No literal colour anywhere in the drawings.
 *
 * On the web this kept `currentColor` working. On RN colour arrives as a prop,
 * so the rule matters more, not less: a hex baked into a mark would survive
 * every theme switch and be invisible in review until someone opened the app
 * in bright sun.
 */
const colourish = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
if (colourish.test(table)) fail('A literal colour appears inside the marks table.');

// ── 4. references ───────────────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && full !== MODULE) out.push(full);
  }
  return out;
}

/** `name="egg"` in JSX, and `icon: 'egg'` in a table like TABS. */
const usagePatterns = [/\bname="([a-z-]+)"/g, /\bicon:\s*'([a-z-]+)'/g];

for (const file of walk(SOURCE)) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('Icon')) continue;

  for (const pattern of usagePatterns) {
    for (const [, name] of text.matchAll(pattern)) {
      // Only complain about names that look like icon names and are missing.
      // A route called "Today" is not an icon reference; a lowercase hyphenated
      // token next to an Icon import almost always is.
      if (!named.has(name) && /^[a-z]+(-[a-z]+)*$/.test(name) && text.includes('from')) {
        const relative = path.relative(ROOT, file);
        if (/\bIcon\b/.test(text) && /icon:|<Icon/.test(text)) {
          fail(`${relative} asks for icon "${name}", which is not in the set.`);
        }
      }
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────

if (problems.length > 0) {
  console.error('check:icons failed\n');
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`check:icons — ${entries.size} marks, both masters, within budget, no literal colour.`);
