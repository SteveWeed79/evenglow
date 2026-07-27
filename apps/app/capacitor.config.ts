import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor — D8. Android first.
 *
 * `webDir` is Vite's output, not a dev server: `pnpm cap:sync` copies the
 * built bundle into the native project, and the APK serves it from the app
 * sandbox. Nothing about the shipped app fetches its own code over the
 * network, which is the point — the five-second cold start in R1 has to hold
 * with the radio off.
 */
const config: CapacitorConfig = {
  appId: 'app.steading',
  appName: 'Steading',
  webDir: 'dist',

  android: {
    /**
     * Mixed content stays off. There is no http endpoint in this app and
     * nothing should be able to introduce one quietly.
     */
    allowMixedContent: false,
    /**
     * Web debugging follows the build type, so a release APK cannot be
     * inspected with devtools while a debug build still can.
     */
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    /**
     * Encryption and biometric unlock are deliberately not enabled yet.
     *
     * The Phase 2 exit gate is about survival — 50 mutations through a hard
     * process kill with nothing lost or duplicated. Turning on an encrypted
     * database at the same time would mean a failed gate has two candidate
     * causes, and the migration plan is explicit that the port comes first
     * and the extras after. C-series hardening tracks the follow-up.
     */
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
  },
};

export default config;
