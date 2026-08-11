import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Screens are tested against stubbed drawing primitives and the real
 * everything-else.
 *
 * The aliases below swap React Native and the four native modules a screen
 * reaches for the doubles in `tests/support/native/`. Nothing under
 * `packages/` or `apps/api/` imports any of them, so this is inert for every
 * suite that was here before.
 *
 * **Runtime only.** `tsc` still resolves the real packages, so a screen using
 * a prop React Native does not have is a typecheck failure exactly as it was —
 * the stubs cannot quietly widen the API.
 *
 * What this buys and what it does not is set out at length in
 * `tests/support/native/react-native.tsx`. The short version: it proves every
 * screen mounts, reads and writes; it proves nothing about how any of it
 * looks. That still needs a handset.
 */
/**
 * Metro turns `require('…/plaster.png')` into an asset descriptor with a
 * density set. Node's loader cannot open a PNG at all, and a resolver alias
 * does not reach a bare `require()` inside a module body — so the call is
 * rewritten to the descriptor the stub exports.
 *
 * Scoped to `apps/mobile` and to `.png` only, so it cannot touch anything
 * else's requires.
 */
const imageRequires = {
  name: 'steading:image-requires',
  transform(code: string, id: string): string | null {
    if (!id.includes('/apps/mobile/') || !/require\((['"])[^'"]+\.png\1\)/.test(code)) return null;
    return code.replace(
      /require\((['"])[^'"]+\.png\1\)/g,
      '({ uri: "test://asset.png", width: 64, height: 64, scale: 1 })',
    );
  },
};

export default defineConfig({
  plugins: [imageRequires],
  resolve: {
    /**
     * One React, by file path and not merely by version.
     *
     * **This is insurance against a half-migrated `node_modules`, and the first
     * version of this comment claimed something else that was not true.** It
     * said `apps/mobile` keeps its own react symlink under
     * `node-linker=hoisted` (`.npmrc`) because it declares react itself. It
     * does not: a clean install resolves react to `node_modules/react` from
     * every workspace package, and the suite passes with this line deleted.
     * The claim was written from the symptom rather than checked, and an
     * adversarial pass disproved it by installing into an empty tree.
     *
     * What actually produced 437 `Invalid hook call` failures was **installing
     * over a tree built by the previous linker**. pnpm rebuilt the root flat
     * and left the old per-package symlinks in place, so:
     *
     *   tests           -> node_modules/react/index.js
     *   apps/mobile/src -> node_modules/.pnpm/react@19.2.3/node_modules/react/index.js
     *
     * Same version, same inode, two paths — so two module registries, and the
     * renderer sets the hook dispatcher on one copy while the component reads
     * it from the other.
     *
     * **The real fix is to delete `node_modules` when the linker changes**, and
     * that is what the docs and the run scripts say to do. This line stays
     * because the failure it prevents is silent, arrives on somebody else's
     * machine, and cannot be reproduced in CI — a fresh runner always installs
     * clean, so CI is green while a developer who merely re-installed is red.
     * It costs nothing and it is the only thing standing between that person
     * and four hundred inscrutable failures.
     */
    dedupe: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-test-renderer'],
    alias: [
      { find: /^react-native$/, replacement: here('./tests/support/native/react-native.tsx') },
      { find: /^expo-haptics$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^react-native-svg$/, replacement: here('./tests/support/native/modules.tsx') },
      {
        find: /^react-native-safe-area-context$/,
        replacement: here('./tests/support/native/modules.tsx'),
      },
      { find: /^expo-secure-store$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^expo-splash-screen$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^expo-crypto$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^expo-file-system$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^expo-sqlite$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^expo-sharing$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^expo-image-picker$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^expo-image-manipulator$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^expo-location$/, replacement: here('./tests/support/native/modules.tsx') },
      // The OAuth flow. Its real hook throws during render when unconfigured,
      // which is why AccountScreen could never be mounted by this suite.
      {
        find: /^expo-auth-session\/providers\/google$/,
        replacement: here('./tests/support/native/modules.tsx'),
      },
      { find: /^expo-web-browser$/, replacement: here('./tests/support/native/modules.tsx') },
      {
        find: /^@react-navigation\/(native|native-stack|bottom-tabs)$/,
        replacement: here('./tests/support/native/navigation.tsx'),
      },
      // Metro turns an image require into an asset descriptor. Node cannot.
      { find: /\.png$/, replacement: here('./tests/support/native/asset.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/support/native/setup.ts'],
    // Each file gets its own database harness, so let them run in isolation
    // rather than racing for the same collections.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
    },
  },
});
