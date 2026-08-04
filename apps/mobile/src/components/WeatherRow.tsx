import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CONDITION_WORDS, degrees, forecastFor } from '@steading/contracts';
import { Icon, type IconName } from './Icon';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';
import { useWeather } from '../hooks/useWeather';
import { useNav } from '../hooks/useNav';
import { SKY_MARKS } from '../weather/marks';

/**
 * The forecast on Today, in one line.
 *
 * ## Why one line and not a card
 *
 * Today is the log path and nothing may compete with it (R1). A weather card
 * with a big numeral would be the second thing on the screen fighting the egg
 * tally, and the tally is the reason people open the app. So this is a row —
 * the same height as everything else — and it says the four things somebody
 * actually decides on before walking out: what it is doing, what it is now,
 * what it will get to and drop to, and whether to expect rain.
 *
 * Everything else is a press away.
 *
 * ## Above the tallies, deliberately
 *
 * The tallies were moved above the due list because a farm opens this app to
 * log, and this sits above THEM anyway — which looks like a contradiction and
 * is not. A row is one line; a tally is an arch with a 90pt numeral. Nothing is
 * pushed off a screen by a single line, and weather read after the eggs are
 * logged is weather read after the decision it was meant to inform.
 *
 * ## What it says when it has nothing
 *
 * Three honest states, none of them a spinner:
 *
 *  - **No position set.** An invitation, because the feature cannot start
 *    without one and a farm has no other way to discover that.
 *  - **Not read yet.** Nothing at all. Rendering "no forecast" during the read
 *    is the defect this codebase has now shipped twice.
 *  - **Stale.** The numbers vanish and the row says when it last heard.
 *    See `FORECAST_STALE_MS`: a two-day-old forecast shown as current is worse
 *    than none, because it is wrong with a confident number on it.
 */

export function WeatherRow(): React.ReactElement | null {
  const { loading, at, weather, measured, units } = useWeather();
  const nav = useNav();
  const { colors } = useTheme();

  // Still reading. Not "no forecast" — see the note above.
  if (loading) return null;

  if (at === null) {
    return (
      <Shell
        onPress={() => nav.navigate('Weather')}
        label="Set where the farm is, for a forecast"
        mark="sky-cloud"
      >
        <Text style={[styles.invite, { color: colors.ink }]}>
          Say where the farm is for a forecast
        </Text>
      </Shell>
    );
  }

  if (weather === null || weather.stale) {
    return (
      <Shell
        onPress={() => nav.navigate('Weather')}
        label="No recent forecast. Opens the weather screen."
        mark="sky-cloud"
      >
        <Text style={[styles.invite, { color: colors.muted }]}>
          {weather === null ? 'No forecast yet' : 'Not heard from the forecast lately'}
        </Text>
      </Shell>
    );
  }

  /**
   * The measured reading wins over the forecast's figure for the hour.
   *
   * The hourly product predicts the current hour; a station reports what a
   * thermometer says. A Kansas summer afternoon can climb ten degrees in half
   * an hour, so the prediction can be badly wrong while this row shows it with
   * a confident numeral — on the one number somebody can check by opening a
   * door. The forecast is the fallback for a farm with no station reporting
   * nearby, and for a reading that has gone quiet.
   */
  const live = measured !== null && !measured.stale ? measured.observation : null;

  const today = forecastFor(weather.forecast.days, Date.now());
  const sky = live?.condition ?? weather.forecast.now.condition;
  const temp = degrees(live?.tempDeciC ?? weather.forecast.now.tempDeciC, units);

  const said = [
    `${CONDITION_WORDS[sky]}, ${temp} degrees now`,
    today === undefined
      ? null
      : `High ${degrees(today.highDeciC, units)}, low ${degrees(today.lowDeciC, units)}`,
    today === undefined || today.rainChance === 0
      ? null
      : `${today.rainChance} per cent chance of rain`,
  ]
    .filter((part): part is string => part !== null)
    .join('. ');

  return (
    <Shell onPress={() => nav.navigate('Weather')} label={said} mark={SKY_MARKS[sky]}>
      <Text style={[styles.now, { color: colors.ink }]}>{temp}°</Text>

      {today === undefined ? null : (
        <Text style={[styles.range, { color: colors.muted }]}>
          {degrees(today.highDeciC, units)}° / {degrees(today.lowDeciC, units)}°
        </Text>
      )}

      {/* Only when there is a chance worth acting on. A row that says "rain 0%"
          every day in August is a row people stop reading. */}
      {today === undefined || today.rainChance === 0 ? null : (
        <Text style={[styles.rain, { color: colors.lanternInk }]}>{today.rainChance}% rain</Text>
      )}
    </Shell>
  );
}

function Shell({
  onPress,
  label,
  mark,
  children,
}: {
  onPress: () => void;
  label: string;
  mark: IconName;
  children: React.ReactNode;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="weather-row"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.raised, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Icon name={mark} size={24} color={colors.muted} />
      <View style={styles.words}>{children}</View>
      <Icon name="forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  /** Wraps rather than truncating: a long range and a rain figure both matter. */
  words: { flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: SPACE.md },
  now: { fontFamily: FONTS.display, fontSize: TYPE.title, fontVariant: ['tabular-nums'] },
  range: { fontFamily: FONTS.data, fontSize: TYPE.body, fontVariant: ['tabular-nums'] },
  rain: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.6 },
  invite: { fontFamily: FONTS.body, fontSize: TYPE.body },
});
