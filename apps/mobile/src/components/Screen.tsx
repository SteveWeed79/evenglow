import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { LampToggle } from './LampToggle';
import { Plaster } from './Plaster';
import { SyncChip } from './SyncChip';
import { Touch } from './Touch';
import { useTrouble } from '../hooks/useTrouble';
import type { RootParamList } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TAP, TYPE } from '../theme/tokens';

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
}): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();
  const trouble = useTrouble();

  return (
    <View style={[styles.ground, { backgroundColor: colors.ground, paddingTop: insets.top }]}>
      {/* Behind everything, never over it. The grain is a shipped tile because
          feTurbulence blended at soft-light has no RN form — see Plaster.tsx. */}
      <Plaster />

      <View style={styles.status}>
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

      <ScrollView
        contentContainerStyle={[styles.content, contentStyle]}
        // Tapping a field then reaching for a stepper should not need the
        // keyboard dismissed first.
        keyboardShouldPersistTaps="handled"
      >
        {/* One block, so the title and the name under it are not separated by
            the content gap that separates whole panels. */}
        <View style={styles.heading}>
          <Text style={[styles.hero, { color: colors.ink }]}>{title}</Text>

          {subtitle === undefined ? null : (
            <Text style={[styles.subtitle, { color: colors.ink }]}>{subtitle}</Text>
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
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  trouble: { gap: SPACE.xs, padding: SPACE.md, borderRadius: 8, borderWidth: 1 },
  troubleTitle: { fontFamily: FONTS.bodyBold, fontSize: TYPE.body },
  troubleBody: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.4 },
  troubleAt: { fontFamily: FONTS.data, fontSize: TYPE.label - 1 },
  ground: { flex: 1 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg,
    minHeight: TAP.min / 2,
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  date: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  control: {
    minWidth: TAP.min / 2,
    minHeight: TAP.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: SPACE.lg, gap: SPACE.md, paddingBottom: SPACE.xl },
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
