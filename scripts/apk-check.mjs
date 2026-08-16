import { readFileSync } from 'node:fs';
import {
  certificateFrom,
  normaliseFingerprint,
  parseBadging,
  sameCertificate,
} from './lib/apk.mjs';

/**
 * The gate between a built APK and anybody's tablet.
 *
 *   node scripts/apk-check.mjs \
 *     --badging badging.txt --certs certs.txt \
 *     --package com.steading.app --version 0.1.13 --code 18 \
 *     --fingerprint "$ANDROID_CERT_SHA256"
 *
 * Every check here exists because the thing it catches **succeeds silently**.
 * A Gradle build that read a stale `app.json`, a keystore exported from the
 * wrong Expo account, the wrong alias inside the right keystore, a secret
 * pasted with a line break — none of those look like errors, all of them
 * produce a perfectly ordinary APK, and the first place the difference shows
 * up is a device, where the fix is an uninstall and an uninstall takes the
 * farm's records with it (`docs/TESTING-BUILD.md` §3, last row).
 *
 * So this fails closed. Anything it cannot positively confirm is a failure,
 * including its own inputs being missing.
 */

const argv = process.argv.slice(2);
const arg = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : (argv[at + 1] ?? null);
};

const read = (name) => {
  const path = arg(name);
  if (path === null) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const problems = [];
const note = (line) => problems.push(line);

// ── what the APK says it is ─────────────────────────────────────────────────
const badging = read('badging');
if (badging === null) {
  note('No `aapt2 dump badging` output to read, so nothing about this APK is confirmed.');
} else {
  const found = parseBadging(badging);
  const expected = {
    package: arg('package'),
    versionName: arg('version'),
    versionCode: arg('code') === null ? null : Number(arg('code')),
  };

  if (found.package !== expected.package) {
    note(`package is \`${found.package}\`, expected \`${expected.package}\`.`);
  }
  if (found.versionName !== expected.versionName) {
    note(`versionName is \`${found.versionName}\`, expected \`${expected.versionName}\`.`);
  }
  if (found.versionCode !== expected.versionCode) {
    // The one that would ship and then refuse to install.
    note(
      `versionCode is \`${found.versionCode}\`, expected \`${expected.versionCode}\` — ` +
        'the stamp did not reach the build.',
    );
  }
}

// ── and who signed it ───────────────────────────────────────────────────────
const certs = read('certs');
const expectedFingerprint = arg('fingerprint');

if (certs === null) {
  note('No `apksigner verify --print-certs` output to read, so the signature is unconfirmed.');
} else if (expectedFingerprint === null || expectedFingerprint === '') {
  note('No expected fingerprint given, so the signature cannot be checked at all.');
} else {
  const actual = certificateFrom(certs);
  if (actual === null) {
    note('No SHA-256 certificate digest in the apksigner output — is the APK signed?');
  } else if (!sameCertificate(actual, expectedFingerprint)) {
    const want = normaliseFingerprint(expectedFingerprint);
    /**
     * Say the length when it is wrong, because that is the difference between
     * "the secret is malformed" and "this is the wrong key" — and those want
     * completely different fixes. A fingerprint is 64 hex characters; anything
     * else came out of a bad copy rather than a bad keystore.
     */
    const shape =
      want.length === 64
        ? ''
        : `\n      ANDROID_CERT_SHA256 reduces to ${want.length} hex characters, not 64` +
          ' — that is a malformed secret rather than a wrong key.';

    note(
      'Signing certificate does not match.\n' +
        `      expected  ${want}\n` +
        `      got       ${actual}` +
        shape +
        '\n      This APK would install as a different app.',
    );
  }
}

if (problems.length > 0) {
  process.stderr.write('\n  This APK must not be published:\n\n');
  for (const problem of problems) process.stderr.write(`    - ${problem}\n`);
  process.stderr.write('\n');
  process.exit(1);
}

process.stdout.write('  APK is what it says it is, signed by the key the farm already has.\n');
