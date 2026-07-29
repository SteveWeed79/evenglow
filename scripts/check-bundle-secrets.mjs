#!/usr/bin/env node
/**
 * B4 — secret hygiene. Fails the build if a secret value reached the client
 * bundle, or if a publicly-inlined variable is carrying something that reads
 * like a credential.
 *
 * Run after `pnpm mobile:export`. Values are read from the environment, so this
 * checks the actual secrets in use rather than a pattern that might not match
 * them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Metro bundle, which is the only client output there is now.
 *
 * This used to scan `.next/static` and `apps/app/dist` and span the migration
 * on purpose — "rather than being repointed on the day the client changes, the
 * day it would most easily be forgotten". Both of those directories are gone
 * with the web client, and the day was indeed forgotten: CI kept running a
 * build step whose script no longer existed, so this never ran at all.
 *
 * The stakes are the ones D8 predicted, and they have arrived. This output is
 * no longer served from a host that can be redeployed — it ships inside an APK
 * (invariant 12), which is trivially unpacked and cannot be recalled from a
 * device.
 *
 * A note on what is scanned: Android exports are Hermes bytecode, not source.
 * String literals still live uncompressed in the bytecode's string table, so a
 * substring search finds a leaked secret exactly as it did in a JS chunk.
 */
const CLIENT_DIRS = [
  'apps/mobile/.expo-export', // `pnpm mobile:export`
];

/** Env vars whose values must never appear in client-side output. */
const SECRET_VARS = [
  'AUTH_SECRET',
  'NEXTAUTH_SECRET',
  'MONGODB_URI',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
];

/**
 * A publicly-inlined name matching this is almost certainly a mistake.
 *
 * `EXPO_PUBLIC_` is the React Native equivalent of `NEXT_PUBLIC_` — anything
 * so prefixed is substituted into the bundle at build time. Both prefixes are
 * checked: the Next one because a stale variable in someone's environment
 * would still be a leak worth naming, and it costs one regex.
 */
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

/**
 * What a bundle can be called.
 *
 * `.hbc` is the one that mattered and was missing: an Android export is Hermes
 * bytecode, so after the client became React Native this check scanned one
 * `metadata.json`, found nothing, and reported a pass — over a bundle with the
 * secret sitting in it. Verified by planting a known string and watching it
 * not be found.
 *
 * `.bundle` covers a non-Hermes export, which is what `--no-bytecode` and the
 * iOS default produce.
 */
const CODE = /\.(hbc|bundle|js|mjs)$/;
const SCANNABLE = /\.(hbc|bundle|js|mjs|css|json|map|txt|html)$/;

let scanned = 0;
let code = 0;

for (const dir of CLIENT_DIRS) {
  for (const file of walk(dir)) {
    if (!SCANNABLE.test(file)) continue;
    scanned++;
    if (CODE.test(file)) code++;

    /**
     * Byte-for-byte, not text.
     *
     * `latin1` maps every byte to one character, so a needle encoded the same
     * way matches exactly wherever it sits — including inside a bytecode
     * string table, where a `utf8` read would have replaced the surrounding
     * binary with U+FFFD and could split a run.
     */
    const contents = readFileSync(file, 'latin1');
    for (const [name, value] of secrets) {
      if (contents.includes(Buffer.from(value, 'utf8').toString('latin1'))) {
        failures.push(`${name} value found in client asset ${file}`);
      }
    }
  }
}

// 2. No publicly-inlined variable may be named like a credential (invariant 7).
for (const name of Object.keys(process.env)) {
  const isPublic = name.startsWith('EXPO_PUBLIC_') || name.startsWith('NEXT_PUBLIC_');
  if (isPublic && SUSPICIOUS_PUBLIC.test(name)) {
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
    `no client assets found in ${CLIENT_DIRS.join(', ')} — run \`pnpm mobile:export\` ` +
      'first, or update CLIENT_DIRS if the build output moved',
  );
} else if (code === 0) {
  /**
   * Scanning something is not the same as scanning the code.
   *
   * The original assertion was "did we scan anything", and a lone
   * `metadata.json` satisfied it while the actual bundle went unread — the
   * vacuous pass this check exists to prevent, wearing a count of 1. The
   * question worth asking is whether a *bundle* was covered.
   */
  failures.push(
    `${scanned} assets scanned but none of them was a bundle — CODE may need a new ` +
      `extension for whatever ${CLIENT_DIRS.join(', ')} now emits`,
  );
}

if (failures.length > 0) {
  console.error('\nSecret hygiene check FAILED:\n');
  for (const failure of failures) console.error(`  • ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(
  `Secret hygiene check passed (${scanned} client assets scanned, ${code} of them bundles, ` +
    `${secrets.length} secrets checked).`,
);
