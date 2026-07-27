#!/usr/bin/env node
/**
 * B4 — secret hygiene. Fails the build if a secret value reached the client
 * bundle, or if a NEXT_PUBLIC_ variable is carrying something that reads like
 * a credential.
 *
 * Run after `next build`. Values are read from the environment, so this checks
 * the actual secrets in use rather than a pattern that might not match them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_DIRS = ['.next/static'];

/** Env vars whose values must never appear in client-side output. */
const SECRET_VARS = [
  'AUTH_SECRET',
  'NEXTAUTH_SECRET',
  'MONGODB_URI',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
];

/** A NEXT_PUBLIC_ name matching this is almost certainly a mistake. */
const SUSPICIOUS_PUBLIC = /(SECRET|TOKEN|PASSWORD|PRIVATE|_KEY|APIKEY|CREDENTIAL|MONGODB|_URI)/i;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // Absent — the scanned-count assertion below decides what that means.
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const failures = [];

// 1. No secret value may appear in a client asset.
const secrets = SECRET_VARS.map((name) => [name, process.env[name]]).filter(
  // Short values would produce meaningless matches.
  ([, value]) => typeof value === 'string' && value.length >= 8,
);

let scanned = 0;
for (const dir of CLIENT_DIRS) {
  for (const file of walk(dir)) {
    if (!/\.(js|mjs|css|json|map|txt|html)$/.test(file)) continue;
    scanned++;
    const contents = readFileSync(file, 'utf8');
    for (const [name, value] of secrets) {
      if (contents.includes(value)) {
        failures.push(`${name} value found in client asset ${file}`);
      }
    }
  }
}

// 2. No NEXT_PUBLIC_ variable may be named like a credential (invariant 7).
for (const name of Object.keys(process.env)) {
  if (name.startsWith('NEXT_PUBLIC_') && SUSPICIOUS_PUBLIC.test(name)) {
    failures.push(`${name} is exposed to the client but is named like a secret`);
  }
}

/**
 * 3. The scan must have covered something.
 *
 * This runs after `pnpm build` in CI, so an empty client directory means the
 * build output moved and this check is now aimed at nothing — reporting
 * "passed, 0 assets scanned" while a secret sits in the bundle. A restructure
 * did exactly this to every guard in the repo, so the vacuous pass is now a
 * failure instead.
 */
if (scanned === 0) {
  failures.push(
    `no client assets found in ${CLIENT_DIRS.join(', ')} — run after a build, ` +
      'or update CLIENT_DIRS if the build output moved',
  );
}

if (failures.length > 0) {
  console.error('\nSecret hygiene check FAILED:\n');
  for (const failure of failures) console.error(`  • ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(
  `Secret hygiene check passed (${scanned} client assets scanned, ${secrets.length} secrets checked).`,
);
