import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './components/AppShell';
// Static, unlike the two below. The sync layer imports this module anyway,
// so a dynamic import cannot move it to its own chunk — it only produces a
// build warning nobody can act on, and warnings nobody can act on are how
// the ones that matter get scrolled past.
import { localStore, setLocalStore } from './db/store';
import { setApiBase } from './api';
import { setStorageBacking } from './sync/storage';
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
  await localStore().wipe();
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

    // The work is in the app sandbox now, not in the WebView's origin storage.
    setStorageBacking('device');

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

/**
 * A failed bootstrap has to say so on the screen.
 *
 * Everything above is fatal on purpose — an APK that silently falls back to
 * the browser store would write a morning's work somewhere the next launch
 * does not read. But "fatal" was implemented as an unhandled rejection, which
 * on a handset means a blank page and nothing else: no message, no devtools
 * unless the build allows them, and no way for the person holding the phone
 * to tell a crash from a slow start.
 *
 * Deliberately no React, no imports, no tokens — this has to work when the
 * reason it is running is that something upstream did not.
 */
function fatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Steading: bootstrap failed', error);

  const root = document.getElementById('root') ?? document.body;
  root.textContent = '';

  const panel = document.createElement('div');
  panel.setAttribute(
    'style',
    'padding:1.5rem;font:16px/1.5 system-ui,sans-serif;color:#241c14;background:#ede6d2;min-height:100vh',
  );

  const heading = document.createElement('h1');
  heading.textContent = 'Steading could not start';
  heading.setAttribute('style', 'font-size:1.25rem;margin:0 0 0.75rem');

  const detail = document.createElement('p');
  detail.textContent = message;
  detail.setAttribute('style', 'margin:0;overflow-wrap:anywhere');

  panel.append(heading, detail);
  root.append(panel);
}

/**
 * A bootstrap that never finishes has to say so too.
 *
 * The first emulator run produced no error and no app: the plaster background
 * and nothing else, no exception in logcat, and none of the native listeners
 * registered. Nothing had failed — it was still waiting, inside a plugin call
 * that never came back. A rejection handler cannot see that, and from the
 * outside a hang and a slow start are the same picture.
 *
 * Generous, because this is a diagnosis of last resort and a cold start on a
 * tired handset is allowed to be slow. It does not cancel anything: if the
 * plugin does eventually answer, the app carries on behind the message.
 */
const BOOTSTRAP_TIMEOUT_MS = 15_000;

let started = false;

const watchdog = setTimeout(() => {
  if (started) return;
  fatal(
    new Error(
      `Startup did not finish within ${BOOTSTRAP_TIMEOUT_MS / 1_000}s. ` +
        'The device database did not respond — nothing has been lost, but this ' +
        'build cannot record anything until it does.',
    ),
  );
}, BOOTSTRAP_TIMEOUT_MS);

void bootstrap()
  .then(() => {
    started = true;
    clearTimeout(watchdog);
  })
  .catch((error: unknown) => {
    clearTimeout(watchdog);
    fatal(error);
  });
