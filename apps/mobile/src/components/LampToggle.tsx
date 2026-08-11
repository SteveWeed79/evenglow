import { StyleSheet } from 'react-native';
import { Icon } from './Icon';
import { Touch } from './Touch';
import { toggleLabel, useTheme } from '../theme/ThemeProvider';
import { TAP } from '../theme/tokens';

/**
 * The lamp in the header (UX-SPEC §4).
 *
 * R3 keeps the top of the screen for status, and this respects that: it is not
 * a primary action, it costs nothing to ignore, and it sits nowhere a thumb
 * reaches on the log path.
 *
 * The web version had to keep its lit state in CSS so the first frame did not
 * disagree with the wall behind it. That whole problem is gone here —
 * `useColorScheme` is correct on the first render, so the icon can simply say
 * what is true.
 */
export function LampToggle(): React.ReactElement {
  const { theme, colors, toggle } = useTheme();
  const label = toggleLabel(theme);

  return (
    <Touch affordance="check"
      onPress={toggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: theme === 'lamplight' }}
      accessibilityLabel={label}
      hitSlop={12}
      style={styles.lamp}
    >
      {/**
       * A lantern, lit or not — one object in two states, which a ring and a
       * filled ring never were. The ring said *on/off* and said nothing about
       * what was being switched; on the one control whose subject is the app's
       * own motif, that was the whole of what it had to say.
       *
       * **40, not 24, and the mark is not 40 wide.** `LANTERN_32` spans 26 of
       * its 32 units so the halo has somewhere to sit inside the viewBox, so a
       * 40px box draws a ~32px lantern — the size at which the hood, the ribs
       * and the flame read as separate things rather than closing into a warm
       * lozenge. Checked against the real header at 16, 24, 32 and 40.
       *
       * The tap target is unchanged: `hitSlop` already carries it past 44.
       */}
      <Icon
        name={theme === 'lamplight' ? 'lamp-lit' : 'lamp-unlit'}
        size={40}
        color={theme === 'lamplight' ? colors.lanternInk : colors.inkQuiet}
        {...(theme === 'lamplight' ? { glow: colors.lantern } : {})}
      />
    </Touch>
  );
}

const styles = StyleSheet.create({
  lamp: {
    minWidth: TAP.min / 2,
    minHeight: TAP.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
