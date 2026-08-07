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
      {/* A ring, filled when lit. The pair differs by the fill and nothing
          else, which is what makes the state readable at this size — and is
          all that survived of a lamp that could never be drawn well at 24px.
          See `Icon.tsx`. */}
      <Icon
        name={theme === 'lamplight' ? 'lamp-lit' : 'lamp-unlit'}
        size={24}
        color={theme === 'lamplight' ? colors.lanternInk : colors.muted}
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
