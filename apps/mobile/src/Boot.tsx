import { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { startSync } from '@steading/core/sync/engine';
import { setStorageBacking } from '@steading/core/sync/storage';
import { setEngineReporter } from '@steading/core/sync/report';
import { reportTrouble } from './hooks/useTrouble';
import { ensureLocalOrgId } from './auth/local-org';
import { start, type Started } from './boot/start';
import { openLocalStore } from './db/store';
import { useAppFonts } from './theme/fonts';
import type { CachedClaims } from './auth/session';
import { useTheme, type ThemeName } from './theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from './theme/tokens';

/**
 * The mark, per theme, so the boot screen wears what the farm chose.
 *
 * **The native splash cannot do this and never will.** Android draws it from
 * resource qualifiers before a line of JavaScript runs, so the only thing it
 * can consult is the phone's own dark mode — which is why a farm that chose
 * lamplight on a light-mode handset was shown the daylight mark and asked for
 * *"a lamplight version with the glowing S"* it already had and could not
 * reach.
 *
 * So the native splash keeps following the device, and this takes over the
 * moment JS knows better. See the hide below for the ordering that makes the
 * handover invisible when the two agree.
 *
 * `require` rather than `import`: Metro resolves bundled assets through it and
 * an import cannot express the density set — the same reason `fonts.ts` and
 * `Plaster.tsx` do it.
 *
 * Bright sun borrows the daylight mark. It is the one theme with no art of its
 * own, and a pale ground is the thing the two have in common; inventing a
 * third rendering to fill the row would be a drawing nobody asked for.
 */
/* eslint-disable @typescript-eslint/no-require-imports --
   The three lines below are asset resolution, not module loading. Same
   exemption and same reason as `fonts.ts` and `Plaster.tsx`. */
const MARKS: Record<ThemeName, ImageSourcePropType> = {
  daylight: require('../assets/splash/steading-daylight.png'),
  lamplight: require('../assets/splash/steading-lamplight.png'),
  sun: require('../assets/splash/steading-daylight.png'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** Matches `imageWidth` in app.json, so the handover does not resize the mark. */
const MARK_WIDTH = 180;

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
  const { colors, theme, ready: themeReady } = useTheme();

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
   * sign-in.
   *
   * ## But they must be THIS device's records, and they were not
   *
   * This used to be `setState({ kind: 'ready' })` and nothing else, so the
   * store handle went on pointing at the farm that had just signed out. **A
   * hand signing out of a shared barn tablet at the end of a shift left the
   * employer's animals, treatments and mortalities on screen for whoever
   * picked it up next**, until another farm was opened or the app was
   * restarted. A plain tenant-isolation failure, on the device rather than the
   * server, and invisible because everything looked exactly as it should.
   *
   * `ensureLocalOrgId` already answers this: signing in to somebody else's
   * farm moves this device's own id aside, and its own comment says signing
   * out again "is the moment that reverses". It was only ever called at the
   * next boot, which is what made the gap a whole session long.
   *
   * Nothing is wiped. The employer's database is a separate file that stays
   * exactly where it is, unsent work included, and opens again on the next
   * sign-in — the queue is the only copy of work that never reached the
   * server, and discarding it to close a display bug would be the worse trade.
   *
   * `openLocalStore` closes the outgoing handle and installs the next one,
   * which bumps the store generation — so a flush or a pull that is mid-round
   * trip for the old farm stops rather than finishing against the new one.
   */
  const onSignedOut = useCallback(() => {
    setState({ kind: 'opening' });
    ensureLocalOrgId()
      .then((orgId) => openLocalStore(orgId))
      .then(
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
   * The splash comes down when this file can draw the same thing itself.
   *
   * `index.ts` holds it open past the first frame, because the first frame
   * lands long before the store is open or the faces are read. This is the
   * other half: without it the splash is held for the life of the process.
   *
   * ## It used to wait for the database, and that is what made the theme wrong
   *
   * The condition was `fonts.ready && state.kind !== 'opening'` — the whole of
   * a cold start spent under a splash Android had chosen from the *phone's*
   * dark mode. A farm that picked lamplight on a light-mode handset booted into
   * the daylight mark every time, and asked for the lamplight one it already
   * had and could not reach.
   *
   * Two things gate it now, and neither is the database: the faces, and whether
   * the stored theme has been read. Both are file reads that settle in single
   * digits of milliseconds. The moment they do, this paints the mark itself in
   * the theme that was actually chosen and holds the screen for the rest of the
   * boot — so the store opening happens under a splash rather than after one.
   *
   * When the phone and the farm agree, which is most of the time, the handover
   * is the same mark on the same ground at the same width and cannot be seen.
   * When they disagree, the switch to the chosen theme *is* the correct
   * behaviour and reads as intent.
   *
   * **The failure branch is reached sooner, which is the point.** An app that
   * cannot open its database has one job — say so in words — and it no longer
   * has to wait behind a logo to do it.
   *
   * `state.kind === 'opening'` recurs mid-run when a farm signs in to a
   * different org. The splash is long gone by then and `hideAsync` is a no-op.
   */
  const canPaint = fonts.ready && themeReady;
  useEffect(() => {
    if (!canPaint) return;
    SplashScreen.hideAsync().catch(() => {
      // Already hidden. Nothing to do, and nothing a farmer could act on.
    });
  }, [canPaint]);

  /**
   * Nothing at all until this file can paint in the right theme.
   *
   * Not a spinner and not a ground colour: the native splash is still up, and
   * anything drawn here would be behind it. Painting a guess would only make
   * the handover a flicker.
   */
  if (!canPaint) return <View style={styles.centre} />;

  if (state.kind === 'ready') return <>{render({ onSignedIn, onSignedOut })}</>;

  return (
    <View style={[styles.centre, { backgroundColor: colors.ground }]} testID="boot">
      {state.kind === 'opening' ? (
        <Image
          source={MARKS[theme]}
          style={styles.mark}
          resizeMode="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel="Steading"
          testID="boot-mark"
        />
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
  mark: { width: MARK_WIDTH, height: MARK_WIDTH },
  title: { fontFamily: FONTS.display, fontSize: TYPE.title, textAlign: 'center' },
  body: {
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
    lineHeight: TYPE.body * 1.45,
    textAlign: 'center',
  },
});
