import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Dimensions,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { LampToggle } from './LampToggle';
import { Plaster } from './Plaster';
import { RevealProvider, scrollToClear, type Measurable, type Reveal } from './reveal';
import { SyncChip } from './SyncChip';
import { Touch } from './Touch';
import { useTrouble } from '../hooks/useTrouble';
import type { RootParamList } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, LAYOUT, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * The wall every screen is drawn on.
 *
 * Header is status only, never actions (R3) — the sync chip and the date —
 * with two exceptions that are not really actions: the lamp, and the way out
 * of the screen you are in.
 *
 * The scroll view lives here rather than per screen so physics and overscroll
 * are identical everywhere. That consistency is one of the things React Native
 * gives free and it is worth not squandering by hand-rolling it four times.
 */
export function Screen({
  title,
  subtitle,
  children,
  contentStyle,
  back = false,
}: {
  title: string;
  /**
   * A line under the hero, in the body face.
   *
   * For a proper noun the app should be saying out loud — the farm's name —
   * rather than for metadata. Deliberately *not* the data face: setting
   * "Sunnyside" in tracked caps is the same mistake as printing a species'
   * collective noun as telemetry, and it would undo the point of showing it.
   */
  subtitle?: string;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
  /** Shows a back chevron instead of the date. Pushed screens only. */
  back?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();
  const trouble = useTrouble();

  /**
   * Room for the keyboard, and the field that wants to be above it.
   *
   * See `reveal.tsx` for why this is not a `KeyboardAvoidingView`. The short
   * version: edge-to-edge means the window no longer resizes when the keyboard
   * opens, so the scroll view has to be told.
   *
   * Both a ref and state, which is not an oversight — the padding needs to
   * re-render and the measurement callback needs the value without closing over
   * a stale render.
   */
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const focused = useRef<Measurable | null>(null);
  const covered = useRef(0);
  const [keyboard, setKeyboard] = useState(0);

  const bring = useCallback((height: number) => {
    const node = focused.current;
    if (node === null || height <= 0) return;

    node.measureInWindow((_x, y, _width, fieldHeight) => {
      const next = scrollToClear({
        fieldTop: y,
        fieldHeight,
        windowHeight: Dimensions.get('window').height,
        keyboardHeight: height,
        margin: SPACE.lg,
        offset: offset.current,
      });
      if (next !== null) scroll.current?.scrollTo({ y: next, animated: true });
    });
  }, []);

  useEffect(() => {
    /**
     * `Did` rather than `Will`, because the field has to be measured against a
     * keyboard that is actually there. On Android `keyboardWillShow` does not
     * fire at all, and measuring against a height of zero would be a no-op on
     * the one platform this ships to.
     */
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const height = event.endCoordinates.height;
      covered.current = height;
      setKeyboard(height);
      bring(height);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      covered.current = 0;
      setKeyboard(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [bring]);

  const reveal = useCallback<Reveal>(
    (node) => {
      focused.current = node;
      /**
       * Moving between two fields with the keyboard already up fires no
       * `keyboardDidShow`, so without this the second field is never brought
       * up — which is every form on this app past the first line.
       */
      if (node !== null) bring(covered.current);
    },
    [bring],
  );

  return (
   <RevealProvider value={reveal}>
    <View style={[styles.ground, { backgroundColor: colors.ground, paddingTop: insets.top }]}>
      {/* Behind everything, never over it. The grain is a shipped tile because
          feTurbulence blended at soft-light has no RN form — see Plaster.tsx. */}
      <Plaster />

      <View style={styles.status}>
        {back ? (
          <Touch affordance="chevron"
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            style={styles.control}
          >
            <Icon name="back" size={24} color={colors.muted} />
          </Touch>
        ) : (
          /**
           * Just the date.
           *
           * It briefly opened What happened, on the argument that a fifth
           * control in this bar would be a fifth thing to look past. That was
           * true and beside the point: a pressable date is not obviously
           * pressable, and a feature nobody finds is a feature nobody has. It
           * is a tab now (UX-SPEC §4), so this goes back to saying the day.
           */
          <Text style={[styles.label, { color: colors.muted }]}>
            {new Date().toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </Text>
        )}

        <View style={styles.controls}>
          {/* Only on a tab, never on a form.
              A quick-add on the screen you are already logging into is noise,
              and a control that appears everywhere stops being noticed. It
              also has nowhere sensible to go from inside a form it would
              replace. */}
          {back ? null : (
            <Touch affordance="chevron"
              onPress={() => navigation.navigate('QuickAdd')}
              accessibilityRole="button"
              accessibilityLabel="Log something"
              accessibilityHint="Records a feed, a job, a treatment or a loss against any group"
              hitSlop={12}
              testID="quick-add"
              style={styles.control}
            >
              <Icon name="plus" size={24} color={colors.lanternInk} />
            </Touch>
          )}
          <SyncChip />
          <LampToggle />
          {back ? null : (
            <Touch affordance="chevron"
              onPress={() => navigation.navigate('Settings')}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              hitSlop={12}
              style={styles.control}
            >
              <Icon name="settings" size={24} color={colors.muted} />
            </Touch>
          )}
        </View>
      </View>

      {/* The scroll surface stays full-bleed and only centres what is on it, so
          a thumb can drag anywhere on a tablet rather than only inside the
          column. `alignItems` here with the cap on the view inside, rather than
          `alignSelf` + `maxWidth` on this container: the container is a
          `NativeScrollContentView` whose width the native scroll view has a
          hand in, so centring it is a bet on internals. Centring a plain child
          inside it is ordinary flexbox and cannot be anything else. */}
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.scroll}
        // Tapping a field then reaching for a stepper should not need the
        // keyboard dismissed first.
        keyboardShouldPersistTaps="handled"
        // Where the surface is, so a field can be scrolled up from wherever it
        // happens to be rather than from the top of the form.
        onScroll={(event) => {
          offset.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
       {/**
         * The bottom inset, which was missing and cost the last centimetre of
         * every pushed screen.
         *
         * `paddingTop: insets.top` was applied above and this was not, so on a
         * handset with gesture navigation the pill sat over whatever was at the
         * bottom of the scroll — reported from a test phone as the bar covering
         * the last few percent. It is worst exactly where it hurts most: R3 puts
         * primary actions in the bottom third, so the button is the thing under
         * the bar.
         *
         * It did not show on the tablet, which is why it survived to a second
         * device, and `TabDividers` already reads `insets.bottom` — so the
         * knowledge was in the codebase, one file away.
         *
         * On the padding rather than the ground, so the inset is scrollable
         * space at the end of the content rather than a dead band the app may
         * not draw into. `contentStyle` still comes after, so a caller can
         * override it.
         */}
       <View
        style={[
          styles.content,
          /**
           * Only where nothing else is already standing in that space.
           *
           * `back` is the signal and it is already here: a pushed screen has no
           * tab bar under it, so the system navigation is what its content
           * would run into. A tab screen has the bar, which reserves the inset
           * itself — adding it again here is a second helping of the same
           * gap, and Today ends in a band of nothing.
           *
           * Wrong in the harmless direction, unlike the two it follows, but
           * wrong for the same reason both of those were: the inset belongs to
           * whichever thing actually meets the bottom of the screen, and that
           * is a different thing on a tab than on a form.
           */
          /**
           * The keyboard stands in the same place, so it takes the same slot
           * rather than stacking with it — `Math.max`, not a sum. The system
           * navigation is *behind* the keyboard when the keyboard is up, and
           * adding both would leave a bar of nothing under the last field.
           *
           * This is the half that makes scrolling possible at all: without
           * somewhere to scroll to, `scrollToClear` computes an offset the
           * surface cannot reach and the field stays put.
           */
          { paddingBottom: SPACE.xl + Math.max(keyboard, back ? insets.bottom : 0) },
          contentStyle,
        ]}
       >
        {/* One block, so the title and the name under it are not separated by
            the content gap that separates whole panels. */}
        <View style={styles.heading}>
          <Text style={[styles.hero, { color: colors.ink }]}>{title}</Text>

          {subtitle === undefined ? null : (
            <Text style={[styles.subtitle, { color: colors.inkQuiet }]}>{subtitle}</Text>
          )}
        </View>

        {/* A read that failed, said out loud.
            Above the content because the content is the thing that is missing:
            a screen that renders nothing and explains nothing is the failure
            this exists to end. It never replaces the screen — everything that
            did load stays on it. */}
        {trouble === null ? null : (
          <View style={[styles.trouble, { borderColor: colors.rowan }]}>
            {/* The border is rowan and the words are not, which is R7 rather
                than a preference: rowan on the lamplight ground is 3.1:1 — a
                perfectly good rule and an unreadable sentence, at 5am, on the
                one banner in the app that appears when something has already
                gone wrong. Keep the bar, set the heading in ink. */}
            <Text style={[styles.troubleTitle, { color: colors.ink }]}>
              Could not read {trouble.where}
            </Text>
            <Text style={[styles.troubleBody, { color: colors.ink }]}>
              Nothing you have logged is lost — it is on this device. {trouble.message}
            </Text>
            {trouble.at === null ? null : (
              <Text style={[styles.troubleAt, { color: colors.muted }]}>{trouble.at}</Text>
            )}
          </View>
        )}
        {children}
       </View>
      </ScrollView>
    </View>
   </RevealProvider>
  );
}

const styles = StyleSheet.create({
  trouble: { gap: SPACE.xs, padding: SPACE.md, borderRadius: 8, borderWidth: 1 },
  troubleTitle: { fontFamily: FONTS.bodyBold, fontSize: TYPE.body },
  troubleBody: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.4 },
  troubleAt: { fontFamily: FONTS.data, fontSize: TYPE.label - 1 },
  ground: { flex: 1 },
  /**
   * The wall fills the screen; the column does not.
   *
   * `width: '100%'` with a `maxWidth` rather than a bare `maxWidth`, because a
   * flex child that is only capped shrinks to its content on a narrow screen —
   * which would break every full-width row on the phones this is drawn for.
   * The pair reads as min(100%, column).
   *
   * Capped here as well as on the content, and the pairing is the point: the
   * lamp and the settings gear left at the far edge of a 1280dp screen would
   * be pointing at a column in the middle of it.
   */
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg,
    minHeight: TAP.min / 2,
    width: '100%',
    maxWidth: LAYOUT.column,
    alignSelf: 'center',
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  date: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  control: {
    minWidth: TAP.min / 2,
    minHeight: TAP.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * `flexGrow: 1` so a short screen still fills the scroll view — without it a
   * container that centres its child also collapses to that child's height,
   * and anything relying on the full height loses it.
   */
  scroll: { flexGrow: 1, alignItems: 'center' },
  content: {
    padding: SPACE.lg,
    gap: SPACE.md,
    paddingBottom: SPACE.xl,
    width: '100%',
    maxWidth: LAYOUT.column,
  },
  // Carries the margin the hero used to, so a screen with no subtitle sits
  // exactly where it did before.
  heading: { gap: 2, marginBottom: SPACE.xs },
  hero: { fontFamily: FONTS.display, fontSize: TYPE.hero },
  subtitle: { fontFamily: FONTS.body, fontSize: TYPE.body },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
