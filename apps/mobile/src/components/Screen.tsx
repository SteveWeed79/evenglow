import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ContentWidthProvider } from './Grid';
import { Icon } from './Icon';
import { LampToggle } from './LampToggle';
import { Plaster } from './Plaster';
import { RevealProvider, scrollToClear, type Measurable, type Reveal } from './reveal';
import { SyncChip } from './SyncChip';
import { Touch } from './Touch';
import { useTrouble } from '../hooks/useTrouble';
import { useWindow } from '../hooks/useWindow';
import { asideWidth, hasRail } from '../theme/window';
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
  wide = false,
  above,
  aside,
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
  /**
   * Lets this screen out of the reading column, as far as `LAYOUT.wide`.
   *
   * **Only for screens whose content is not prose.** The 600dp cap is a
   * measure — 70–80 characters of body text — and widening it for a screen
   * made of sentences and rows is the "metre of plaster" failure `tokens.ts`
   * describes, arriving by invitation instead of by accident.
   *
   * Two kinds of screen have earned it. A **chart** has no line length to
   * ruin, and width there is literally more information: a season's
   * production at 1000dp shows more days than at 600. A **hub** is a grid of
   * equivalent things rather than a column of prose — the canonical feed
   * layout — and `<Grid>` puts a floor under how narrow a cell may get, so the
   * rows inside it never stretch past their own measure however wide the
   * screen is.
   *
   * `LAYOUT.wide` rather than "the whole window" on purpose: it is the same
   * 1104 a two-pane screen will assemble to, so moving between a hub and Today
   * does not shift the content sideways under somebody's eye.
   */
  wide?: boolean;
  /**
   * Content that spans both panes, under the hero and above everything else.
   *
   * For the things that **outrank the pane they would otherwise sit in**. On
   * Today that is the weather alerts: `TodayScreen` argues its ordering at
   * length — a farm reading top to bottom must not meet "your hens are warm"
   * before a meteorologist saying a tornado is on the ground — and a safety
   * banner parked in a side column is a banner nobody reads.
   *
   * At one pane this is simply the first thing under the hero, which is where
   * those banners already are. So a screen that moves them here reads
   * identically on a phone and correctly on a tablet.
   */
  above?: React.ReactNode;
  /**
   * The supporting pane, when there is room for one.
   *
   * Beside the column at `TWO_PANE_AT` and up; **below it** otherwise, which
   * is Material's own answer for a compact window and the only one compatible
   * with invariant 13. Nothing may be lost by being narrow, so this is never
   * dropped — only restacked.
   *
   * Which means the order matters and is fixed: hero, `above`, `children`,
   * `aside`. A screen has to be readable top to bottom in that order on a
   * phone, because on a phone that is exactly what it is.
   */
  aside?: React.ReactNode;
}): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  /**
   * `!back` is "this is a tab screen", which is the same signal the bottom
   * inset below already reads and for the same underlying fact: a pushed
   * screen has no tab bar under it, and above the expanded boundary that bar
   * is a rail taking width off the side.
   */
  const { usable, panes, width: windowWidth } = useWindow({ bar: !back });

  const cap = wide ? LAYOUT.wide : LAYOUT.column;

  /**
   * Two panes only when there is both room and something to put in the second.
   *
   * A screen with no `aside` keeps the centred column it has always had,
   * however wide the window is — the room is not a reason to invent a second
   * column, and `wide` is the separate, deliberate opt-out for the screens
   * that want the width without a pane.
   */
  const split = panes === 2 && aside !== undefined;
  const asidePane = asideWidth(usable);

  /**
   * The margin is `LAYOUT.margin` when split and `SPACE.lg` when not, and that
   * is not an inconsistency — it is the same number `asideWidth` already
   * subtracted. The aside is sized as "whatever is left after the column, the
   * spacer and two margins", so the frame has to actually spend those margins
   * or the arithmetic and the layout disagree by 8dp.
   */
  /**
   * Whether anything is standing at the bottom of this screen.
   *
   * Only a tab screen whose bar has not become a rail. A pushed screen never
   * had one; a tab screen on an expanded window has it beside the content
   * instead of beneath it.
   */
  const barAtBottom = !back && !hasRail(windowWidth);

  const gutter = split ? LAYOUT.margin : SPACE.lg;
  const frame = split ? LAYOUT.column + LAYOUT.spacer + asidePane + gutter * 2 : cap;

  /**
   * What `<Grid>` divides up: the column, less its own padding.
   *
   * Handed down rather than measured, because `onLayout` reports nothing in a
   * suite with no layout engine — a grid that waited for it would render zero
   * columns in every test. This is the same arithmetic the layout engine will
   * do, from the same tokens, which is the method `landscape-fold.test.ts`
   * already established for this codebase.
   */
  const content = split ? LAYOUT.column : Math.min(usable, cap) - SPACE.lg * 2;
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
  const focused = useRef<Measurable | null>(null);
  const covered = useRef(0);
  const [keyboard, setKeyboard] = useState(0);

  /**
   * The surfaces a field can be brought up on, and which one it is on.
   *
   * One was enough while every screen was a single scroll view. A split screen
   * has three — the frame, which does not scroll at all, and one per pane —
   * and the tally's number field sits in the *leading pane* on a tablet, so
   * scrolling the frame it hangs in would move nothing. Which pane is answered
   * by the tree rather than by geometry: each wraps its children in its own
   * `RevealProvider`, and `useRevealOnFocus` reads the nearest one.
   */
  const column = useSurface();
  const leading = useSurface();
  const trailing = useSurface();
  const on = useRef<Surface>(column);

  const bring = useCallback((height: number) => {
    const node = focused.current;
    if (node === null || height <= 0) return;
    const surface = on.current;

    node.measureInWindow((_x, y, _width, fieldHeight) => {
      const next = scrollToClear({
        fieldTop: y,
        fieldHeight,
        windowHeight: Dimensions.get('window').height,
        keyboardHeight: height,
        margin: SPACE.lg,
        offset: surface.at.current,
      });
      if (next !== null) surface.view.current?.scrollTo({ y: next, animated: true });
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

  const reveal = useMemo(() => {
    const onto =
      (surface: Surface): Reveal =>
      (node) => {
        focused.current = node;
        if (node === null) return;

        on.current = surface;
        /**
         * Moving between two fields with the keyboard already up fires no
         * `keyboardDidShow`, so without this the second field is never brought
         * up — which is every form on this app past the first line.
         */
        bring(covered.current);
      };

    return { column: onto(column), leading: onto(leading), trailing: onto(trailing) };
  }, [bring, column, leading, trailing]);

  /**
   * Everything under the bar: the hero, whatever spans both panes, and then
   * either the two panes or the single column.
   *
   * Named rather than written inline because it hangs in a different frame on
   * each path — a scroll view when there is one column, a still box when there
   * are two — and writing it twice is how the two paths drift.
   */
  const body = (
    <View
     style={[
       styles.content,
       { maxWidth: frame, paddingHorizontal: gutter },
       /**
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
        */
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
       /**
        * **A rail is not under the content, so it reserves nothing.**
        *
        * This read `back ? insets.bottom : 0` on the reasoning that a tab
        * screen has the bar beneath it and the bar reserves the inset
        * itself. That was true right up until the bar moved to the leading
        * edge — and then nothing at all was standing at the bottom of a tab
        * screen, so "Also today" ran under the system navigation. Reported
        * off the tablet in the first screenshot of the rail.
        *
        * The rule the old code was reaching for is the one below: the inset
        * belongs to whichever thing actually meets the bottom of the screen,
        * and on an expanded window that is the content itself.
        */
       { paddingBottom: SPACE.xl + Math.max(keyboard, barAtBottom ? 0 : insets.bottom) },
       /**
        * **The height the panes divide up, and the reason they can scroll.**
        *
        * `styles.panes` is `flex: 1`, which resolves against its parent — so
        * without this the row is as tall as its content, every pane inside it
        * is as tall as *its* content, and a scroll surface the size of its own
        * content has nothing to scroll. Only on the split path: on the other
        * one this box is the scroll view's content and must be free to grow
        * past the window, which is the whole idea of a scroll view.
        */
       split ? styles.fill : null,
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

     {/* Spans both panes, because it outranks either of them. See `above`. */}
     {above}

     {/**
       * Two panes, or one column with the aside restacked under it.
       *
       * The narrow branch is deliberately a bare fragment rather than a
       * one-column version of the row: `styles.content` already supplies
       * the gap between children, and wrapping them in a second flex
       * container would add a box that changes nothing and can only
       * introduce a difference between the two paths. A phone renders
       * exactly the tree it rendered before this prop existed.
       */}
     {split ? (
       /**
        * Two panes, each scrolling itself.
        *
        * `styles.panes` stretches them rather than aligning to the top, and
        * that is the half of this change that is easy to get wrong. The old
        * row used `flex-start` so *"a short aside must not stretch to match
        * a long column, or its last card grows a foot of empty card"* —
        * which was right for two plain views. These are scroll surfaces: the
        * surface stretches to the height available and the cards inside it
        * do not, so the card keeps its size and gains somewhere to scroll.
        *
        * Each pane carries its own `RevealProvider`, so a field that takes
        * focus says which surface has to move by where it sits in the tree.
        * The alternative was working it out from the field's x against the
        * pane boundary, which is arithmetic over a layout that has a rail, two
        * insets and a centred frame in it — and wrong by a pane the first time
        * any of those moves.
        */
       <View style={styles.panes}>
         <ScrollView
           ref={leading.view}
           style={{ width: LAYOUT.column }}
           contentContainerStyle={styles.pane}
           keyboardShouldPersistTaps="handled"
           onScroll={(event) => {
             leading.at.current = event.nativeEvent.contentOffset.y;
           }}
           scrollEventThrottle={16}
         >
           <RevealProvider value={reveal.leading}>{children}</RevealProvider>
         </ScrollView>
         <ScrollView
           ref={trailing.view}
           style={{ width: asidePane }}
           contentContainerStyle={styles.pane}
           keyboardShouldPersistTaps="handled"
           onScroll={(event) => {
             trailing.at.current = event.nativeEvent.contentOffset.y;
           }}
           scrollEventThrottle={16}
         >
           <RevealProvider value={reveal.trailing}>{aside}</RevealProvider>
         </ScrollView>
       </View>
     ) : (
       <>
         {children}
         {aside}
       </>
     )}
    </View>
  );

  return (
   <RevealProvider value={reveal.column}>
   <ContentWidthProvider value={content}>
    <View style={[styles.ground, { backgroundColor: colors.ground, paddingTop: insets.top }]}>
      {/* Behind everything, never over it. The grain is a shipped tile because
          feTurbulence blended at soft-light has no RN form — see Plaster.tsx. */}
      <Plaster />

      {/**
        * The horizontal insets go on the children, never on the ground.
        *
        * They were read nowhere in this app until now. `paddingTop` and the
        * bottom inset cover a phone completely, because in portrait the
        * cutout and the gesture bar are both on the short edges — but the app
        * turns on a tablet, and in landscape they move to the left or right
        * edge where nothing was reserving for them. It has gone unreported
        * because the content sat 340dp from either edge; `wide` is what closes
        * that gap, so this has to land in the same pass.
        *
        * On the children rather than the ground because `<Plaster />` is an
        * `absoluteFill` inside the ground, and padding there would inset the
        * wall as well — letterboxing the app in bare background, which is the
        * failure `reading-column.test.tsx` already stands guard over.
        */}
      {/**
        * The bar spans the window. It does not take the column's measure.
        *
        * **This used to be `maxWidth: cap`, and the pairing was deliberate** —
        * `reading-column.test.tsx` argued that *"capping only the content would
        * leave the lamp and the settings gear at the far edge of a 1280dp
        * screen pointing at a column in the middle of it."* That cost is real
        * and it is the one being paid here.
        *
        * What it bought was worse. `cap` is `wide ? LAYOUT.wide :
        * LAYOUT.column`, so the bar moved with the *content's* measure: on
        * Settings, Iron and Today it sat at the window's edges, and on
        * Machines, Animals, Crops and every form it pulled in to 600dp. The
        * back chevron therefore jumped several hundred points sideways between
        * one screen and the next, which is what a person actually notices —
        * reported off the tablet as the bar being *"centered on some screens
        * and sides oriented on other"*.
        *
        * A measure is for prose. A chevron and a lamp are chrome: they belong
        * to the window, they are in the same place on every screen, and the
        * thumb learns one position rather than two.
        */}
      <View style={[styles.status, {
        paddingLeft: SPACE.lg + insets.left,
        paddingRight: SPACE.lg + insets.right,
      }]}>
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

      {/**
        * The frame under the bar: the scroll surface, or — where there are two
        * panes — the still box they scroll inside.
        *
        * **A scroll view nested in a scroll view has no height to scroll in,
        * and that is why neither column moved.** The panes were children of
        * this one, which was stilled with `scrollEnabled={!split}` — and that
        * stops the drag without bounding the box. A scroll view laid out with
        * no height takes its content's, so each pane grew as tall as its own
        * list and had nowhere left to move; the surface under them would not
        * scroll either, so a tablet showed two columns cut off at the bottom of
        * the window with no way down. Reported off the tablet.
        *
        * The fix is a definite height, which only a frame that is not itself a
        * scroll surface can give: on the split path a plain `View` that fills
        * the window, with `styles.panes` taking what is left of it and each
        * pane stretching to that. The single-column path is untouched — every
        * form and every phone renders the tree it always did, keyboard-reveal
        * machinery and all.
        *
        * What a split screen gives up is scrolling as a whole: the hero and
        * `above` stay put and only the panes move. That is what list-detail
        * does everywhere it is drawn, and it is the price of the two columns
        * being independent — which is the point of them.
        *
        * Why independent, kept from the change that separated them: one scroll
        * surface held both columns, so dragging the tractor's timeline dragged
        * the tractor list up with it and off the top, leaving a column of
        * nothing beside a column of history. The left names what you are
        * looking at and the right is as long as the record happens to be;
        * tying them to one scroll makes the shorter one a passenger.
        */}
      {split ? (
        <View
          style={[
            styles.scroll,
            styles.fill,
            // The same insets the scroll's container carries on the other path.
            { paddingLeft: insets.left, paddingRight: insets.right },
          ]}
        >
          {body}
        </View>
      ) : (
        /* The scroll surface stays full-bleed and only centres what is on it, so
           a thumb can drag anywhere on a tablet rather than only inside the
           column. `alignItems` here with the cap on the view inside, rather than
           `alignSelf` + `maxWidth` on this container: the container is a
           `NativeScrollContentView` whose width the native scroll view has a
           hand in, so centring it is a bet on internals. Centring a plain child
           inside it is ordinary flexbox and cannot be anything else. */
        <ScrollView
          ref={column.view}
          // The insets pad the scroll's CONTAINER, so the column is centred
          // inside the safe area rather than inside the window. The scroll
          // surface itself stays full-bleed — a thumb can still drag anywhere on
          // a tablet, which is what the comment above is about.
          contentContainerStyle={[
            styles.scroll,
            { paddingLeft: insets.left, paddingRight: insets.right },
          ]}
          // Tapping a field then reaching for a stepper should not need the
          // keyboard dismissed first.
          keyboardShouldPersistTaps="handled"
          // Where the surface is, so a field can be scrolled up from wherever it
          // happens to be rather than from the top of the form.
          onScroll={(event) => {
            column.at.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
        >
          {body}
        </ScrollView>
      )}
    </View>
   </ContentWidthProvider>
   </RevealProvider>
  );
}

/**
 * A scroll surface a focused field can be brought up on.
 *
 * The view, and where it currently sits — a `scrollTo` is an absolute offset,
 * so moving a field by a delta means knowing where the surface already is.
 * Paired in one object because `bring` closes over whichever surface the field
 * turned out to be on, and two loose refs cannot be picked as a pair.
 */
interface Surface {
  view: React.RefObject<ScrollView | null>;
  at: React.RefObject<number>;
}

function useSurface(): Surface {
  const view = useRef<ScrollView>(null);
  const at = useRef(0);
  // Stable for the life of the screen: `on` holds one of these across renders.
  return useMemo(() => ({ view, at }), [view, at]);
}

/**
 * The hero of a supporting pane.
 *
 * A pane has no `Screen` of its own, so nothing gives its contents a name —
 * and the row that selected them is one of many in the other column and may
 * well have been scrolled past. A pane that opened with "1.9 kg, 27 Jul" and
 * no heading would be a list of numbers about nothing.
 *
 * The same face and size as the screen hero, deliberately: it is the title of
 * what you are looking at, and a smaller one would rank the pane below the
 * list rather than beside it.
 */
export function PaneTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  const { colors } = useTheme();
  return <Text style={[styles.hero, { color: colors.ink }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  trouble: { gap: SPACE.xs, padding: SPACE.md, borderRadius: 8, borderWidth: 1 },
  troubleTitle: { fontFamily: FONTS.bodyBold, fontSize: TYPE.body },
  troubleBody: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.4 },
  troubleAt: { fontFamily: FONTS.data, fontSize: TYPE.label - 1 },
  ground: { flex: 1 },
  /** Takes the height it is given rather than the height of what is in it. */
  fill: { flex: 1 },
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
   *
   * The cap itself is applied inline, because a `wide` screen moves both this
   * and the content out to `LAYOUT.wide` together. Moving only one of them
   * would put the gear inside the content on a hub, which is the same mistake
   * the paragraph above is about, mirrored.
   */
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TAP.min / 2,
    width: '100%',
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
    paddingTop: SPACE.lg,
    gap: SPACE.md,
    paddingBottom: SPACE.xl,
    width: '100%',
  },
  /**
   * The two panes.
   *
   * `flex: 1` and `stretch`, because each pane is its own scroll surface and a
   * scroll surface with no height scrolls nothing. The row takes what is left
   * under the hero; the panes take the row; the lists inside them overflow and
   * are dragged. All three of those depend on the frame above having a
   * definite height — see the split branch in `Screen`.
   *
   * This once read *"one scroll surface for both, not one each"*, on the
   * argument that two scroll regions on a touch screen means a drag that does
   * something different depending on which half of the glass it started on.
   * True, and the farm reported the cost as the worse one: a machine's
   * timeline is as long as the machine is old, and dragging it took the list
   * beside it off the top of the screen.
   */
  panes: { flexDirection: 'row', gap: LAYOUT.spacer, alignItems: 'stretch', flex: 1 },
  /** Repeats the content gap, which the row's own `gap` is spending sideways. */
  pane: { gap: SPACE.md },
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
