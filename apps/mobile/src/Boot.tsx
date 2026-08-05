import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { startSync } from '@steading/core/sync/engine';
import { setStorageBacking } from '@steading/core/sync/storage';
import { setEngineReporter } from '@steading/core/sync/report';
import { reportTrouble } from './hooks/useTrouble';
import { start, type Started } from './boot/start';
import { openLocalStore } from './db/store';
import { useAppFonts } from './theme/fonts';
import type { CachedClaims } from './auth/session';
import { useTheme } from './theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from './theme/tokens';

/**
 * Opening the database and starting the sync loop before the first screen renders.
 *
 * Blocking, deliberately. The web build rendered immediately and installed the
 * store afterwards, and the window between those two facts is where the worst
 * bug of the last migration lived: screens read from a database that had never
 * been written to, and adding stock silently did nothing at all. A screen that
 * cannot have rendered against the wrong store cannot have that bug.
 *
 * The wait is a migration ladder against a local file — single-digit
 * milliseconds after the first launch — so there is no splash worth designing
 * here. What matters is the failure branch: an app that cannot open its
 * database must say so in words, not show an empty list. An empty list is
 * indistinguishable from a farm with no animals, which is the single most
 * dangerous thing this app could tell someone.
 */

/**
 * **There is no signed-out state any more, and that is the change.**
 *
 * This used to hold a `signed-out` branch that rendered the sign-in screen
 * instead of the app — the wall §1 of `ACCESS-AND-BILLING.md` is about. A farm
 * now opens the org its device minted and works from the first launch (A2.1),
 * so the only question left is whether a database is open, which is the same
 * question for a claimed farm and an unclaimed one.
 *
 * Signing in is still reachable, from My Farm, at the three moments in A2.3
 * where an account actually buys something.
 */
type State =
  | { kind: 'opening' }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string };

export function Boot({
  render,
}: {
  /**
   * Given the two callbacks that move the app between sessions.
   *
   * Both, rather than only the sign-out one, because signing in is no longer
   * something that happens in front of the app — it happens inside it, from My
   * Farm, on a device that has been logging for weeks.
   */
  render: (session: {
    onSignedIn: (claims: CachedClaims) => void;
    onSignedOut: () => void;
  }) => React.ReactNode;
}): React.ReactElement {
  const [state, setState] = useState<State>({ kind: 'opening' });
  const { colors } = useTheme();

  /**
   * The faces, in parallel with the database.
   *
   * Held before the first screen for one reason: without it the app paints a
   * frame in Roboto and then reflows into Fraunces and Alegreya, which is a
   * visible jolt on every cold start. The wait is reading four files out of
   * the APK, so it is shorter than the store's migration ladder and usually
   * costs nothing at all.
   *
   * It cannot fail the boot — see `useAppFonts`. A typeface is cosmetic and
   * the records are not.
   */
  const fonts = useAppFonts();

  /**
   * The engine's failures reach the screen, not just Metro.
   *
   * Installed before `start()` so nothing the loop does on its first tick can
   * fail somewhere nobody can see.
   */
  useEffect(() => {
    setEngineReporter((where, error) => reportTrouble(where, error));
  }, []);

  useEffect(() => {
    let live = true;
    let started: Started | null = null;

    start().then(
      (handles) => {
        started = handles;
        // Torn down already: stop what we just started rather than leaving a
        // flush loop running against a screen that is gone.
        if (!live) handles.stop();
        else setState({ kind: 'ready' });
      },
      (error: unknown) => {
        if (live) {
          setState({
            kind: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );

    return () => {
      live = false;
      started?.stop();
    };
  }, []);

  /**
   * A session arriving mid-run: claiming this farm, or signing in to another.
   *
   * **Claiming is the cheap case and it is the common one.** The org the
   * server just adopted is the org already open, so `openLocalStore` finds its
   * memoised handle and returns the same database — no reopen, no migration,
   * no window where a screen reads one file while the queue writes another.
   * That is what A2.2 bought by refusing to let the server assign a new id.
   *
   * Signing in to a *different* farm — a hand joining, a second phone — really
   * does open another file, which is the one case that needs the wait.
   */
  const onSignedIn = useCallback((claims: CachedClaims) => {
    setState({ kind: 'opening' });
    openLocalStore(claims.orgId).then(
      () => {
        setStorageBacking('device');
        startSync();
        setState({ kind: 'ready' });
      },
      (error: unknown) =>
        setState({
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }, []);

  /**
   * Signing out no longer drops to a door, because there is not one.
   *
   * The farm's records are on this device and the app still works — that is
   * the whole premise, and it is now true after a sign-out as well as before a
   * sign-in. The tokens are gone, so the engine will defer every batch as
   * unauthenticated, which is the state it already handles.
   *
   * The engine is left running deliberately: the queue is per farm and still
   * on disk, so stopping it would only delay the next flush without protecting
   * anything.
   */
  const onSignedOut = useCallback(() => setState({ kind: 'ready' }), []);

  // Both gates, and the font one never turns into a failure branch.
  if (!fonts.ready) {
    return (
      <View style={[styles.centre, { backgroundColor: colors.ground }]}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  if (state.kind === 'ready') return <>{render({ onSignedIn, onSignedOut })}</>;

  return (
    <View style={[styles.centre, { backgroundColor: colors.ground }]}>
      {state.kind === 'opening' ? (
        <ActivityIndicator color={colors.muted} />
      ) : (
        <>
          <Text style={[styles.title, { color: colors.ink }]}>Steading could not start</Text>
          {/* Named plainly: this is the one screen where a farmer needs to be
              able to read something back to whoever can help. */}
          <Text style={[styles.body, { color: colors.muted }]}>
            Nothing you have logged is lost — it is on this device. {state.message}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.xl, gap: SPACE.md },
  title: { fontFamily: FONTS.display, fontSize: TYPE.title, textAlign: 'center' },
  body: {
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
    lineHeight: TYPE.body * 1.45,
    textAlign: 'center',
  },
});
