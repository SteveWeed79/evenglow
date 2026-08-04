import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Alert, AlertSeverity } from '@steading/contracts';
import { Icon } from './Icon';
import { useWeather } from '../hooks/useWeather';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * Official watches and warnings, at the top of Today.
 *
 * ## Why this is not a `Warning`
 *
 * The strip below this one is the app's own opinion: your alpacas plus this
 * humidity is a heat problem. Those are computed on the device and are worth
 * having because nobody else knows what stock is in which field.
 *
 * This is not an opinion. It is a meteorologist saying a tornado is on the
 * ground, and it is the only thing on this screen with an authority behind it.
 * So it sits above everything — a farm reading top to bottom must not meet
 * "your hens are warm" before it meets a tornado warning — and it is drawn
 * loud enough that the ordering is obvious without reading either.
 *
 * ## Tappable, and what that is for
 *
 * Every alert carries several hundred words of official text: what is
 * happening, where, and what to do. That cannot go on Today — it would push
 * the egg tally off the screen, which is the failure this screen already
 * records twice. It also must not be thrown away, because "TAKE COVER NOW.
 * MOVE TO A BASEMENT" is the part that matters and it is not in the headline.
 *
 * So the row shows the event and the headline, and opens to the full text.
 * That is the same shape as the notes and photos on the group screen, for the
 * same reason: the thing itself is the control, and looking at it costs one
 * tap rather than a permanent button.
 *
 * ## Nothing to dismiss
 *
 * The same four reasons `WeatherWarnings` gives, and harder here. An alert
 * cancelled by the service disappears on the next fetch — which is a real
 * clearance, from the people who issued it — and anything else would be this
 * app deciding a farm has seen a tornado warning.
 *
 * ## Not a weather radio, and it says so
 *
 * This polls every fifteen minutes over a network that may not be there. A
 * farm must not be left believing an app on a phone in a barn is what stands
 * between them and a tornado, so the strip says where it came from and how it
 * is meant to be used.
 */

/** Rowan for the two that mean act now; brass for the rest. */
function loud(severity: AlertSeverity): boolean {
  return severity === 'extreme' || severity === 'severe';
}

export function WeatherAlerts(): React.ReactElement | null {
  const { alerts } = useWeather();
  const { colors } = useTheme();
  const [open, setOpen] = useState<string | null>(null);

  // Nothing in force, so nothing is drawn. The common case by a wide margin.
  if (alerts.length === 0) return null;

  return (
    <View style={styles.strip} testID="weather-alerts">
      {alerts.map((alert) => (
        <AlertRow
          key={alert.id}
          alert={alert}
          open={open === alert.id}
          onPress={() => setOpen(open === alert.id ? null : alert.id)}
        />
      ))}

      <Text style={[styles.source, { color: colors.muted }]}>
        From the National Weather Service, checked when this app has signal. Not a substitute for
        a weather radio.
      </Text>
    </View>
  );
}

function AlertRow({
  alert,
  open,
  onPress,
}: {
  alert: Alert;
  open: boolean;
  onPress: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const edge = loud(alert.severity) ? colors.rowan : colors.lanternInk;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      // Said as one sentence. A screen reader landing on "Tornado Warning"
      // alone gets the alarm without the where or the when.
      accessibilityLabel={`${alert.event}. ${alert.headline ?? ''} ${
        open ? '' : 'Tap for the full warning.'
      }`}
      testID={`alert-${alert.id}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: loud(alert.severity) ? colors.alertTint : colors.raised,
          borderColor: edge,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.head}>
        <Icon name="waterer" size={24} color={edge} />
        <View style={styles.words}>
          <Text style={[styles.title, { color: colors.ink }]}>{alert.event}</Text>
          {alert.headline === undefined ? null : (
            <Text style={[styles.detail, { color: colors.muted }]}>{alert.headline}</Text>
          )}
          {alert.area === undefined ? null : (
            <Text style={[styles.where, { color: colors.muted }]}>{alert.area}</Text>
          )}
        </View>
        <Icon name={open ? 'minus' : 'plus'} size={16} color={colors.muted} />
      </View>

      {open ? (
        <View style={styles.full} testID={`alert-full-${alert.id}`}>
          {/* Instruction first. It is what to DO, and on the row somebody
              opened during a tornado warning it must not be below four
              paragraphs of meteorology. */}
          {alert.instruction === undefined ? null : (
            <Text style={[styles.instruction, { color: colors.ink }]}>{alert.instruction}</Text>
          )}
          {alert.description === undefined ? null : (
            <Text style={[styles.detail, { color: colors.muted }]}>{alert.description}</Text>
          )}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: { gap: SPACE.sm },
  row: {
    gap: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    // Two, where a derived warning gets one. The weight IS the ranking, and it
    // has to read before any of the words do.
    borderWidth: 2,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md },
  words: { flex: 1, gap: SPACE.xs },
  full: { gap: SPACE.sm },
  title: { fontFamily: FONTS.display, fontSize: TYPE.lede },
  instruction: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  detail: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  where: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
  source: { fontFamily: FONTS.body, fontSize: TYPE.label, lineHeight: TYPE.label * 1.4 },
});
