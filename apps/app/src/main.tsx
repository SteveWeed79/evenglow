import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './components/AppShell';
import { wipeLocalData } from './db/open';
// Static, unlike the two below. The sync layer imports this module anyway,
// so a dynamic import cannot move it to its own chunk — it only produces a
// build warning nobody can act on, and warnings nobody can act on are how
// the ones that matter get scrolled past.
import { setLocalStore } from './db/store';
import { setApiBase } from './api';
import { isNative } from './platform';
import './styles.css';

/**
 * The Vite entry.
 *
 * Deliberately thin. The shell, the tabs and every screen are the same modules
 * Next renders today — this only decides where they mount and what they mount
 * over, which are the two things that genuinely differ between a browser and a
 * WebView shipping inside an APK.
 */

/**
 * Sign-out, pending the token client.
 *
 * Clears the device, which is the half that matters for a shared barn tablet
 * (C5): the next person to sign in must not read the previous farm's records.
 * It does NOT yet revoke the refresh token server-side — there is no token
 * client on this entry to hold one, so there is nothing to revoke. When that
 * lands it calls POST /auth/logout, which S3b already built and tested.
 */
async function signOut(): Promise<void> {
  await wipeLocalData();
  window.location.reload();
}

/**
 * On device, swap the store to SQLite before anything renders.
 *
 * Dynamically imported, and that is not a nicety: a static import would pull
 * the sqlite plugin into the browser bundle, where it cannot work and has no
 * business being. It also keeps `capacitor-driver.ts` — the one file allowed
 * to touch the plugin — out of every build that has no plugin to touch.
 *
 * A failure here is fatal on purpose. Falling back to IndexedDB on a handset
 * would produce an app that looks fine and writes a morning's work to a store
 * the next launch does not read.
 */
async function bootstrap(): Promise<void> {
  if (isNative()) {
    /**
     * Storage first, and the order here is load-bearing — see below.
     */
    const [{ openCapacitorSqlDriver }, { openSqliteStore }] = await Promise.all([
      import('./db/capacitor-driver'),
      import('./db/sqlite-store'),
    ]);

    setLocalStore(await openSqliteStore(await openCapacitorSqlDriver()));

    const { startNativeTriggers } = await import('./sync/native-triggers');
    await startNativeTriggers();

    /**
     * The APK serves the app from its own origin, so a relative `/sync`
     * resolves to the bundle rather than to a server. Absent, this fails at
     * bootstrap rather than at the first flush — a device that queues all
     * morning and only reveals the problem when someone checks the sync chip
     * is the worse of the two failures by a wide margin.
     *
     * **This check must come after the dynamic imports above, and that is not
     * a style preference.** Vite replaces `import.meta.env.VITE_API_BASE_URL`
     * with a literal at build time, so with no value configured the condition
     * folds to a constant, the throw becomes unconditional, and Rollup
     * eliminates every statement after it as unreachable — including the
     * imports of the sqlite driver. The build succeeds, says nothing, and
     * produces an APK containing no database at all. Ordered this way, a
     * missing value is a clear error at launch instead.
     *
     * `pnpm check:chunks` asserts the driver survived, so this cannot regress
     * back to a silent one.
     */
    const apiBase = import.meta.env.VITE_API_BASE_URL;
    if (apiBase === undefined || apiBase === '') {
      throw new Error(
        'VITE_API_BASE_URL is not set. The native build needs an absolute API origin — ' +
          'a relative path resolves to the app bundle. See the README, Android section.',
      );
    }
    setApiBase(apiBase);
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('No #root element — index.html and main.tsx disagree.');

  createRoot(root).render(
    <StrictMode>
      <AppShell signOutAction={signOut} />
    </StrictMode>,
  );
}

void bootstrap();
