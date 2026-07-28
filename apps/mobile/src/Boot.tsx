import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { openLocalStore } from './db/store';
import { useTheme } from './theme/ThemeProvider';
import { font, space, type as typeScale } from './theme/tokens';

/**
 * Opening the database before the first screen renders.
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

type State = { kind: 'opening' } | { kind: 'ready' } | { kind: 'failed'; message: string };

export function Boot({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<State>({ kind: 'opening' });
  const { colors } = useTheme();

  useEffect(() => {
    let live = true;
    openLocalStore().then(
      () => live && setState({ kind: 'ready' }),
      (error: unknown) =>
        live && setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === 'ready') return <>{children}</>;

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
            The local database did not open. Nothing you have logged is lost — it is on this
            device. {state.message}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  title: { fontFamily: font.display, fontSize: typeScale.title, textAlign: 'center' },
  body: {
    fontFamily: font.body,
    fontSize: typeScale.body,
    lineHeight: typeScale.body * 1.45,
    textAlign: 'center',
  },
});
