#!/usr/bin/env node
/**
 * The native build must still contain a database.
 *
 * `main.tsx` reaches the sqlite driver through a dynamic import, which is what
 * keeps the plugin out of the browser bundle. Dynamic imports are also the
 * easiest thing in a bundle to lose by accident: anything that makes the code
 * above them provably unreachable takes them with it, and Rollup does that
 * silently because from its point of view it is doing exactly what it should.
 *
 * That is not hypothetical. Vite replaces `import.meta.env.VITE_*` with a
 * literal at build time, so a guard clause reading one folds to a constant. A
 * `throw` placed above the imports became unconditional, every statement after
 * it was eliminated, and `pnpm build:app` reported success while producing an
 * APK with no database driver in it at all — an app that installs, launches,
 * and dies. It was caught by reading the chunk list, which is not a control.
 *
 * So the chunk list is the control now. Run after `pnpm build:app`.
 */
import { readdirSync } from 'node:fs';

const ASSETS = 'apps/app/dist/assets';

/**
 * Vite names a chunk after its entry module, so these are stable across
 * content-hash changes. Bare filenames rather than paths — the hash sits
 * between the name and the extension.
 */
const REQUIRED = [
  { name: 'capacitor-driver', why: 'the sqlite driver — without it the app has no database' },
  { name: 'sqlite-store', why: 'the LocalStore over SQLite' },
  { name: 'native-triggers', why: 'resume and network-regain flush' },
];

let files;
try {
  files = readdirSync(ASSETS);
} catch {
  console.error(
    `\nNative chunk check FAILED:\n\n  • ${ASSETS} does not exist — run pnpm build:app first\n`,
  );
  process.exit(1);
}

const missing = REQUIRED.filter(({ name }) => !files.some((file) => file.startsWith(`${name}-`)));

if (missing.length > 0) {
  console.error('\nNative chunk check FAILED:\n');
  for (const { name, why } of missing) {
    console.error(`  • ${name} is not in the build — ${why}`);
  }
  console.error(
    '\nA dynamic import in apps/app/src/main.tsx was dropped. The usual cause is\n' +
      'code above it becoming unreachable at build time, which eliminates\n' +
      'everything after it without a warning. See the comment in main.tsx.\n',
  );
  process.exit(1);
}

console.log(`Native chunk check passed (${REQUIRED.length} chunks present of ${files.length}).`);
