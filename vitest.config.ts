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
    alias: [
      { find: /^react-native$/, replacement: here('./tests/support/native/react-native.tsx') },
      { find: /^expo-haptics$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^react-native-svg$/, replacement: here('./tests/support/native/modules.tsx') },
      {
        find: /^react-native-safe-area-context$/,
        replacement: here('./tests/support/native/modules.tsx'),
      },
      { find: /^expo-secure-store$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^expo-file-system$/, replacement: here('./tests/support/native/modules.tsx') },
      { find: /^expo-sharing$/, replacement: here('./tests/support/native/modules.tsx') },
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
