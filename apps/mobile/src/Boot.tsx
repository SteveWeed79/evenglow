import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { startSync } from '@steading/core/sync/engine';
import { setStorageBacking } from '@steading/core/sync/storage';
import { start, type Started } from './boot/start';
import { openLocalStore } from './db/store';
import { SignInScreen } from './screens/SignInScreen';
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

type State =
  | { kind: 'opening' }
  | { kind: 'signed-out' }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string };

export function Boot({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<State>({ kind: 'opening' });
  const { colors } = useTheme();

  useEffect(() => {
    let live = true;
    let started: Started | null = null;

    start().then(
      (handles) => {
        started = handles;
        // Torn down already: stop what we just started rather than leaving a
        // flush loop running against a screen that is gone.
        if (!live) handles.stop();
        else setState({ kind: handles.claims === null ? 'signed-out' : 'ready' });
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
   * Signing in finishes the boot the session could not.
   *
   * `start()` stops early when nobody is signed in, because the database is
   * per farm and there was no orgId to open one with. Now there is.
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

  if (state.kind === 'ready') return <>{children}</>;
  if (state.kind === 'signed-out') return <SignInScreen onSignedIn={onSignedIn} />;

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
