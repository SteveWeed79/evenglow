import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Appearance, StyleSheet, Text, View } from 'react-native';
import { leaveBreadcrumb } from '../support/breadcrumb';
import { Touch } from './Touch';
import { APP_BUILD, APP_VERSION } from '../version';
import { THEMES } from '../theme/tokens';

/**
 * The screen a farm gets instead of a white one.
 *
 * `[39]`. One thrown render anywhere took the entire tree: React unmounts the
 * whole app when nothing catches, so a defect in a single row on a single
 * screen presented as the app dying. On a handset there is no console to look
 * at and no reload button — there is a farmer in a barn with a phone that no
 * longer starts, and nothing on it that says why.
 *
 * ## Why this one file has a class in it
 *
 * `CLAUDE.md` says function components and hooks, no class components, and that
 * rule is right everywhere it can be followed. **React has no hook form of
 * `componentDidCatch`** — an error boundary is a class or it does not exist. So
 * this is the exception, it is one component, and it does nothing else: it
 * catches, it writes the crumb, it draws the fallback.
 *
 * ## Outside everything, including the theme
 *
 * Mounted above `ThemeProvider` and `Boot` in `App.tsx`, because the failures
 * worth catching include the ones in them — a store that will not open, a
 * provider that throws on a malformed preference. That is also why nothing here
 * uses a hook, a context or the store: **the fallback must not depend on
 * anything that could be the thing that failed.** It reads the phone's own
 * colour scheme directly rather than the farm's chosen look, which is the one
 * visible cost and is worth it.
 *
 * ## What it offers, and what it deliberately does not
 *
 * *Try again* remounts the subtree. That is the honest fix for the common case
 * — a transient read, a screen reached in a state it did not expect — and it
 * costs nothing when it does not work.
 *
 * There is no "report this" button, and its absence is the point of the
 * breadcrumb: filing a report needs the support screen, the support screen is
 * inside the tree that just failed, and a button that reopened it would be
 * offering the farm the thing that is broken. The crumb is on disk instead, and
 * the next launch that works carries it into the bundle without anybody having
 * to do anything on the worst screen in the app.
 */

interface BoundaryProps {
  children: ReactNode;
  /** Called with what was caught. Tests use it; the app leaves it out. */
  onCaught?: ((error: unknown) => void) | undefined;
}

interface BoundaryState {
  /** Non-null means the fallback is showing. */
  failure: { message: string } | null;
  /** Bumped by *Try again*, which remounts the children by changing their key. */
  attempt: number;
}

export class Boundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failure: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { failure: { message: error instanceof Error ? error.message : String(error) } };
  }

  /**
   * The crumb is written here rather than in `getDerivedStateFromError`,
   * because that method must stay pure — React may call it twice, and two
   * writes of one crash is the crash loop this file guards against in
   * miniature.
   */
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const stack = info.componentStack;
    leaveBreadcrumb('drawing the app', error, typeof stack === 'string' ? stack : undefined);

    this.props.onCaught?.(error);
  }

  private readonly retry = (): void => {
    this.setState((current) => ({ failure: null, attempt: current.attempt + 1 }));
  };

  override render(): ReactNode {
    const { failure, attempt } = this.state;
    // Keyed, so *Try again* genuinely remounts the subtree rather than
    // re-rendering a tree that is still holding whatever state broke it.
    if (failure === null) {
      return (
        <View key={attempt} style={styles.fill}>
          {this.props.children}
        </View>
      );
    }

    // The phone's scheme, not the farm's: reading the farm's would mean asking
    // the provider this may have been thrown by.
    const colors = Appearance.getColorScheme() === 'dark' ? THEMES.lamplight : THEMES.daylight;

    return (
      <View style={[styles.screen, { backgroundColor: colors.ground }]} testID="boundary">
        <Text style={[styles.title, { color: colors.ink }]}>Something went wrong here.</Text>

        {/* Said before anything else, because it is the only question a farm
            has at this moment and every second it goes unanswered is a second
            somebody spends wondering whether the morning's work is gone. */}
        <Text style={[styles.body, { color: colors.ink }]}>
          Nothing you logged has been lost. It is on this phone and it will go up as soon as the
          app is running again.
        </Text>

        {/* Brass: the one thing this screen is for. `Touch` is the only file
            allowed to import `Pressable`, and it is a plain wrapper with no
            theme or store behind it — which is what makes it safe to use on a
            screen that exists because something else failed. */}
        <Touch
          affordance="brass"
          accessibilityRole="button"
          onPress={this.retry}
          style={[styles.button, { backgroundColor: colors.lantern }]}
          testID="boundary-retry"
        >
          <Text style={[styles.buttonLabel, { color: colors.ground }]}>Try again</Text>
        </Touch>

        <Text style={[styles.body, { color: colors.muted }]}>
          If it keeps happening, close the app and open it again. The details have been kept, and
          they will be attached to the next report you send from Settings.
        </Text>

        {/* Selectable, so somebody on the phone to us can read it out. */}
        <Text style={[styles.detail, { color: colors.muted }]} selectable testID="boundary-detail">
          {failure.message}
          {'\n'}
          {APP_VERSION} · build {APP_BUILD || 'local'}
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, gap: 20, justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 17, lineHeight: 24 },
  button: { alignItems: 'center', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 16 },
  buttonLabel: { fontSize: 18, fontWeight: '700' },
  detail: { fontSize: 13, lineHeight: 18 },
});
