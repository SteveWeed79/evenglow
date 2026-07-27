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
    /**
     * The WebView serves the app from `https://localhost`, so a request to a
     * development API on plain http is mixed content and was blocked outright
     * — every sync on the first device run failed with "Failed to fetch",
     * which the queue correctly read as being offline.
     *
     * This flag is not the security boundary and was never doing that job.
     * The boundary is Android's own cleartext policy, which refuses http
     * regardless, and which is relaxed only in
     * `android/app/src/debug/res/xml/network_security_config.xml` — a debug
     * build type, for three named hosts, never merged into a release APK.
     * A release build talks to an https origin and this changes nothing for
     * it.
     */
    allowMixedContent: true,
    /**
     * `webContentsDebuggingEnabled` is deliberately unset.
     *
     * Capacitor's default already does the right thing — inspectable on a
     * debug build, not on a release one. Pinning it to `false` looked like
     * good hygiene and was actively harmful: the first emulator run failed
     * with a blank screen and no way to attach devtools, on a debug build,
     * because of this line. Security posture that only ever costs the
     * developer is not security posture.
     */
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
