import { StyleSheet, Text, View } from 'react-native';
import { Arch } from './Arch';
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
