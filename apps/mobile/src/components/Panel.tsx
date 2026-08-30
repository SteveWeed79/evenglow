import { StyleSheet, Text, View } from 'react-native';
import { Arch } from './Arch';
import { Touch, type TouchProps } from './Touch';
import { Worn } from './Worn';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, LIFT, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * A surface on the wall, in two shapes — and which one is not decoration.
 *
 * **The arch is load-bearing: arch = something you can act on.** A panel that
 * only tells you something wears no door. So `<Panel>` is a plain card and
 * `<ArchPanel>` is the doorway, and a screen that mixes them up has said
 * something untrue about what its contents do.
 *
 * The arch could not survive as a style. `--arch` is two radii per corner —
 * half the width across, a fixed 32 down — and RN's `borderRadius` is circular
 * only with no second value. So it is drawn: `<Arch>` measures itself and
 * paints one path behind its children.
 */

export function Panel({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View
      style={[styles.panel, LIFT, { backgroundColor: colors.raised, borderColor: colors.border }]}
    >
      {/* The lit top edge and shaded bottom one. Was an inset box-shadow,
          which RN does not have — see Worn.tsx. */}
      <Worn radius={RADII.softHead} />
      {label ? <Text style={[styles.label, { color: colors.muted }]}>{label}</Text> : null}
      {children}
    </View>
  );
}

/**
 * The doorway. For anything the farmer acts on.
 *
 * Padding goes on the content, not on `<Arch>` — it reports nothing about
 * layout, it only paints. And no `<Worn>` inside it: the top edge is a curve
 * here, and a straight hairline across it would cut the head off. An arch that
 * wants a lit edge takes the `stroke` prop instead.
 */
export function ArchPanel({
  children,
  spring,
}: {
  children: React.ReactNode;
  spring?: number;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Arch
      fill={colors.raised}
      stroke={colors.border}
      strokeWidth={colors.borderWidth}
      {...(spring === undefined ? {} : { spring })}
      style={[styles.arch, LIFT]}
    >
      {children}
    </Arch>
  );
}

/**
 * The doorway with a hand on it: an `<ArchPanel>` you can press.
 *
 * ## Why the motif was spending nothing
 *
 * UX-SPEC §2 makes the arch the one shape the app is built from — *"every
 * card, the Tally frame, primary buttons, sheets, and the empty-state panels
 * are arched at the top and squared at the base... makes the app recognizable
 * from across a room"* — and it is load bearing rather than decorative:
 * **arch = something you can act on**, a flat rectangle is read-only.
 *
 * It shipped on the Tally and nowhere else. `ArchPanel` was written and never
 * called, the hub cards were rounded rectangles, and `Primary` was
 * `RADII.softHead`. So the one arch in the app read as an oddity rather than a
 * motif — reported off the tablet as the arch cards feeling out of place,
 * which they did, because there was one of them.
 *
 * ## The head is painted, so the content has to clear it
 *
 * `<Arch>` reports nothing about layout; it measures itself and paints behind
 * whatever it is given. The head is `ARCH.spring` deep **at the jambs** and
 * nothing at the centre, so a first line of text starting at the left padding
 * meets the curve about halfway down it. `SPACE.xl` of top padding clears that
 * with room, which is what makes a card sit *inside* its doorway rather than
 * under it — and it is why an arched card is taller than the rectangle it
 * replaces.
 *
 * ## Pressable outside, painted inside
 *
 * `Touch` wraps rather than nests inside, so the whole door is the tap target
 * and the grid's stretched cell is what it grows into (`flexGrow`, see
 * `Grid`). The arch fills that with `flex: 1`, which is what keeps the painted
 * face the same height as the card beside it.
 */
export function ArchCard({
  onPress,
  affordance = 'chevron',
  testID,
  accessibilityLabel,
  children,
}: {
  onPress: () => void;
  affordance?: TouchProps['affordance'];
  testID?: string;
  accessibilityLabel?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touch
      affordance={affordance}
      onPress={onPress}
      accessibilityRole="button"
      {...(testID === undefined ? {} : { testID })}
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      // Fills the cell `<Grid>` already stretched — see `Grid`.
      style={({ pressed }) => [styles.door, { opacity: pressed ? 0.8 : 1 }]}
    >
      <Arch
        fill={colors.raised}
        stroke={colors.border}
        strokeWidth={colors.borderWidth}
        style={styles.doorFace}
      >
        {children}
      </Arch>
    </Touch>
  );
}

export function Body({ children }: { children: React.ReactNode }): React.ReactElement {
  const { colors } = useTheme();
  return <Text style={[styles.body, { color: colors.ink }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACE.lg,
    gap: SPACE.sm,
    overflow: 'hidden',
  },
  /**
   * No paint of its own: the arch inside does that, and a background here
   * would be a rectangle showing at the shoulders of the head.
   */
  door: { flexGrow: 1 },
  doorFace: {
    flex: 1,
    // Clears the head — see `ArchCard`. Everything else matches the rectangle
    // this replaced, so only the top of a card moved.
    paddingTop: SPACE.xl,
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.lg,
    gap: SPACE.sm,
  },
  /**
   * The head needs room the corners of a card do not. Top padding clears the
   * spring so a first line of text sits inside the curve rather than under it.
   */
  arch: {
    paddingTop: SPACE.xl + SPACE.md,
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.lg,
    gap: SPACE.sm,
  },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  body: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.45 },
});
