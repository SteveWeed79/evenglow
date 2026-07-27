import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The client build (D10).
 *
 * Output is a static bundle — no server, no SSR — because a Capacitor app is
 * files in a WebView with nothing running behind them. That constraint is the
 * whole reason Next is being replaced rather than configured.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Matches the package's own exports map, so imports read the same inside
      // the app as they do from outside it.
      '@steading/app': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    // Named for the secret scan, which follows the build output across the
    // migration rather than being repointed on the day it changes.
    emptyOutDir: true,
    sourcemap: false,
  },
});
