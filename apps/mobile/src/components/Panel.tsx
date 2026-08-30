import { StyleSheet, Text } from 'react-native';
import { Surface } from './Surface';
import { Touch, type TouchProps } from './Touch';
import { Worn } from './Worn';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, LIFT, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * A surface on the wall — one shape now, where there were two.
 *
 * **The arch used to be load-bearing: arch = something you can act on**, and a
 * panel that only told you something wore no door. The farmer removed the
 * motif, so that distinction is gone from the paint: `<Panel>` and `<Card>`
 * are the same rounded rectangle and only pressability separates them.
 *
 * What carries the difference now is `<Touch>`, which `<Card>` wraps and
 * `<Panel>` does not — the chevron, the press state and the button role. That
 * was always the literal affordance; the arch was a second, silent copy of it,
 * and losing it costs the across-the-room recognition UX-SPEC §2 wanted rather
 * than any information about what a card does.
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
    <Surface
      fill={colors.raised}
      stroke={colors.border}
      strokeWidth={colors.borderWidth}
      glow={colors.glow}
      style={[styles.panel, LIFT]}
    >
      {/* The lit top edge and shaded bottom one. Was an inset box-shadow,
          which RN does not have — see Worn.tsx. Kept: it is a hairline at the
          very edge and the glow is a wash below it, so they stack rather than
          fight. */}
      <Worn radius={RADII.softHead} />
      {label ? <Text style={[styles.label, { color: colors.muted }]}>{label}</Text> : null}
      {children}
    </Surface>
  );
}

/**
 * @deprecated The arch is gone; this is `<Panel>` under its old name.
 *
 * Kept rather than deleted because removing a name is not what was asked for,
 * and an alias costs one line. It has no call sites — it never had any, which
 * is the defect `motif.test.tsx` was written about — so the rename can happen
 * whenever without touching a screen.
 */
export const ArchPanel = Panel;

/**
 * A `<Panel>` you can press.
 *
 * ## What the motif was, and why removing it costs less than it looks
 *
 * The section below is kept because it records why the arch was spread across
 * every card in the first place — it had shipped on the Tally alone, read as an
 * oddity, and was reported off the tablet as *the arch cards feeling out of
 * place*. Widening it was the fix for that, and it worked: they stopped looking
 * out of place and started looking like a bay window on a wide card, because
 * the head is `w / 2` across and 32 down, so at card width the ellipse is 500
 * by 32 — a warped top edge rather than a doorway.
 *
 * That is the whole argument against it, and it is a scaling problem rather
 * than a taste one: the motif reads at chip and button width and dissolves
 * everywhere else. The farmer's call was to remove it and put the lamp glow on
 * every card instead, which keeps the light that made a card feel lit and drops
 * the silhouette that only worked narrow.
 *
 * ## The head is gone, so the padding that cleared it is too
 *
 * A first line of text used to start below `SPACE.xl` because the head was 32
 * deep at the jambs and a line at the left padding met the curve halfway down.
 * With a flat top edge there is nothing to clear, so this is `SPACE.lg` like
 * every other surface — which makes every card in the app shorter by the
 * difference, and is the one change here that is not about colour.
 *
 * ## The original note on the motif, kept
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
 * ## Pressable outside, painted inside
 *
 * `Touch` wraps rather than nests inside, so the whole card is the tap target
 * and the grid's stretched cell is what it grows into (`flexGrow`, see
 * `Grid`). The surface fills that with `flex: 1`, which is what keeps the
 * painted face the same height as the card beside it.
 */
export function Card({
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
      <Surface
        fill={colors.raised}
        stroke={colors.border}
        strokeWidth={colors.borderWidth}
        glow={colors.glow}
        style={styles.doorFace}
      >
        {children}
      </Surface>
    </Touch>
  );
}

/** @deprecated The arch is gone; this is `<Card>` under its old name. */
export const ArchCard = Card;

export function Body({ children }: { children: React.ReactNode }): React.ReactElement {
  const { colors } = useTheme();
  return <Text style={[styles.body, { color: colors.ink }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  /**
   * No border or background of its own — `<Surface>` paints both. The radius
   * stays so children clip to the same corners the path draws, and `overflow`
   * keeps `<Worn>`'s hairlines inside them.
   */
  panel: {
    borderRadius: RADII.softHead,
    padding: SPACE.lg,
    gap: SPACE.sm,
    overflow: 'hidden',
  },
  door: { flexGrow: 1 },
  doorFace: {
    flex: 1,
    // Was `SPACE.xl` to clear the arched head. There is no head — see `Card`.
    padding: SPACE.lg,
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
