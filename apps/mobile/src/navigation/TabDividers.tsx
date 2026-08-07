import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_DIVIDER } from './tab-marks';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The hairlines between the tabs. See `TAB_DIVIDER` for why they are short.
 *
 * `pointerEvents="none"` because they sit across the bar and a tab is one of
 * the two things in this app tapped through a glove — a decorative line that
 * swallowed even a pixel of a target would be the worst possible trade.
 *
 * **Equal flex slots, not percentage offsets.** The first version positioned
 * each line with `left: '66.666…%'` and only one of the two ever drew — a
 * percentage on an absolutely-positioned child resolves against a box that is
 * not reliably the one you think it is. `count` slots at `flex: 1` divide the
 * bar exactly the way the navigator divides it, because it is the same
 * mechanism, and a line on the left edge of every slot but the first lands on
 * each boundary by construction rather than by arithmetic.
 *
 * Rotation and a tablet still come free: flex does not care how wide the bar
 * is.
 *
 * **Except the bottom safe area, which is not free.** React Navigation adds the
 * home-indicator inset as padding *below* the height set in `tabBarStyle`, so
 * the container this fills is taller than the part anybody looks at — by 34pt
 * on the phones that have one. Centring in the container would drop the lines
 * a sixth of a bar below the marks they divide, which is exactly the sort of
 * thing that looks fine in Node and wrong in the hand.
 */
export function TabDividers({ count }: { count: number }): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.row, { bottom: insets.bottom }]}
      pointerEvents="none"
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.slot}>
          {/* On the LEFT edge of every slot but the first, which is what puts
              one on each boundary and none on an outer edge — without the
              arithmetic that put only one of two on the screen. */}
          {i === 0 ? null : (
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  /** Exactly as wide as a tab, because it is divided the same way. */
  slot: { flex: 1 },
  divider: {
    position: 'absolute',
    left: 0,
    top: `${TAB_DIVIDER.inset * 100}%`,
    bottom: `${TAB_DIVIDER.inset * 100}%`,
    width: StyleSheet.hairlineWidth,
  },
});
