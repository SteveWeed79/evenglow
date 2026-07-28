import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { LampToggle } from './LampToggle';
import { SyncChip } from './SyncChip';
import type { RootParamList } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { font, space, tap, type as typeScale } from '../theme/tokens';

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
  children,
  contentStyle,
  back = false,
}: {
  title: string;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
  /** Shows a back chevron instead of the date. Pushed screens only. */
  back?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();

  return (
    <View style={[styles.ground, { backgroundColor: colors.ground, paddingTop: insets.top }]}>
      <View style={styles.status}>
        {back ? (
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            style={styles.control}
          >
            <Icon name="back" size={24} color={colors.muted} />
          </Pressable>
        ) : (
          <Text style={[styles.label, { color: colors.muted }]}>
            {new Date().toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </Text>
        )}

        <View style={styles.controls}>
          <SyncChip />
          <LampToggle />
          {back ? null : (
            <Pressable
              onPress={() => navigation.navigate('Settings')}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              hitSlop={12}
              style={styles.control}
            >
              <Icon name="settings" size={24} color={colors.muted} />
            </Pressable>
          )}
        </View>
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
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  control: {
    minWidth: tap.min / 2,
    minHeight: tap.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
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
