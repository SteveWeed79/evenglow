import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LampToggle } from './LampToggle';
import { useTheme } from '../theme/ThemeProvider';
import { font, space, tap, type as typeScale } from '../theme/tokens';

/**
 * The wall every screen is drawn on.
 *
 * Header is status only, never actions (R3) — the date on the left, the lamp
 * and eventually the sync chip on the right. The scroll view exists here
 * rather than per screen so scroll physics and the bounce are identical
 * everywhere; that consistency is one of the things RN gives for free and it
 * is worth not squandering.
 */
export function Screen({
  title,
  children,
  contentStyle,
}: {
  title: string;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
}): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.ground, { backgroundColor: colors.ground, paddingTop: insets.top }]}>
      <View style={styles.status}>
        <Text style={[styles.label, { color: colors.muted }]}>
          {new Date().toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          })}
        </Text>
        <LampToggle />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, contentStyle]}
        // Tapping a field then reaching for a stepper should not need the
        // keyboard dismissed first.
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.hero, { color: colors.ink }]}>{title}</Text>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    minHeight: tap.min / 2,
  },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl },
  hero: { fontFamily: font.display, fontSize: typeScale.hero, marginBottom: space.xs },
  label: {
    fontFamily: font.data,
    fontSize: typeScale.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
