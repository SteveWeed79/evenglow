import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The worn top edge and the shaded bottom one.
 *
 * The handoff lists this as unsolved, and it is unsolvable *as written*: the
 * web token is an inset box-shadow —
 *
 *   --worn: inset 0 1px 0 rgba(255,255,255,.7), inset 0 -1px 0 rgba(36,28,20,.06);
 *
 * — and React Native has no inset shadows at all. `shadowOffset` only ever
 * casts outward.
 *
 * So it is drawn instead of shaded. Two hairlines, absolutely positioned along
 * the top and bottom of the parent, in the same colours the inset shadow used.
 * That is not an approximation of the effect — an inset box-shadow with zero
 * blur and a 1px offset *is* two hairlines, so this is the same thing arrived
 * at from the other side.
 *
 * `StyleSheet.hairlineWidth` rather than 1, deliberately. At 3× density a
 * literal 1dp line is three physical pixels and reads as a drawn border rather
 * than as a lit edge; hairlineWidth is the thinnest line the display can
 * actually make.
 *
 * ## Where this cannot go
 *
 * Every surface is a rectangle now, so the old restriction is gone: this used
 * to be excluded from an `<Arch>`, where the top edge was a curve and a
 * straight hairline across it would cut the head off. An arch that wants a lit
 * edge gets it from a second stroked path, not from this — see the `stroke`
 * prop on `<Surface>`.
 */
export function Worn({ radius = 0 }: { radius?: number }): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View
        style={[
          styles.edge,
          styles.top,
          { backgroundColor: colors.worn, borderTopLeftRadius: radius, borderTopRightRadius: radius },
        ]}
      />
      <View
        style={[
          styles.edge,
          styles.bottom,
          {
            backgroundColor: colors.shade,
            borderBottomLeftRadius: radius,
            borderBottomRightRadius: radius,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
