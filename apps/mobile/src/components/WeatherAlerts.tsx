import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { alertCoverage, type Alert, type AlertSeverity } from '@homefarm/contracts';
import { Icon } from './Icon';
import { Secondary } from './Form';
import { Touch } from './Touch';
import { localStore } from '@homefarm/core/db/store';
import { useLive } from '../hooks/useLive';
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
 * ## Nothing to dismiss — and what is offered instead
 *
 * The same four reasons `WeatherWarnings` gives, and harder here. An alert
 * cancelled by the service disappears on the next fetch — which is a real
 * clearance, from the people who issued it — and anything else would be this
 * app deciding a farm has seen a tornado warning.
 *
 * **All four still hold, and none of them is an argument against a smaller
 * row.** This was reported twice from a handset: two heat products in force,
 * each drawing its own nineteen-county list, filling the screen from breakfast
 * to dusk. The second report is what settled it, and the answer is not
 * dismissal:
 *
 *  - The area list is cut to a count until the row is opened. It was the bulk
 *    of the height and the least useful line in it — see `alertCoverage`.
 *  - An alert can be marked read, which collapses it to ONE LINE. It stays on
 *    Today, keeps its colour, still opens to the full official text. Nothing
 *    is hidden and nothing is silenced, so "the app being wrong at three in
 *    the afternoon" cannot happen — the warning is still on the screen.
 *
 * Marking read is keyed to the service's own alert id, which is what stops it
 * becoming a completion flag that drifts. A farm cannot mark "heat" read; it
 * marks one product read, and the upgrade from watch to warning, or tomorrow's
 * fresh warning, is a different id and arrives at full size. The reflex that
 * taps things away cannot reach next week's tornado.
 *
 * ## The provenance line is gone from here
 *
 * Two fixed lines used to sit under the strip — where the alerts come from,
 * and that this is not a weather radio. Removed at the farm's request, and
 * worth recording rather than just deleting.
 *
 * The argument for them was that a farm must not believe a phone in a barn is
 * what stands between them and a tornado. That is still true and is still
 * said: an alert opens to the National Weather Service's own text, headline
 * and instruction included, and `WeatherScreen` names the source in full. What
 * this strip was doing was repeating it on Today, permanently, above the
 * groups — the same complaint that shrank the rows and added marking read, and
 * the two lines were the part that could never be collapsed.
 *
 * A disclaimer nobody can dismiss is one nobody reads by the second week, and
 * it was costing the most valuable space on the screen every day to say
 * something the alert itself says when opened.
 */

/** Stable identity, because `useLive` resubscribes on an unstable reader. */
const readAlertsSeen = (): Promise<string[]> => localStore().getReadAlerts();

/** Rowan for the two that mean act now; brass for the rest. */
function loud(severity: AlertSeverity): boolean {
  return severity === 'extreme' || severity === 'severe';
}

export function WeatherAlerts(): React.ReactElement | null {
  const { alerts } = useWeather();
  const [open, setOpen] = useState<string | null>(null);

  const stored = useLive(readAlertsSeen, 'which warnings you have read');

  /**
   * Marked in this session, held here as well as written down.
   *
   * `useLive` re-reads when the sync engine publishes, and marking an alert
   * read is not a farm record — it publishes nothing, so the stored list would
   * not come back until something else happened to touch the queue. Without
   * this the row stays full-size after the tap and the button looks broken.
   *
   * Reaching for the engine's `nudge()` instead would be worse: it would make
   * reading a weather warning attempt a network flush.
   */
  const [justRead, setJustRead] = useState<readonly string[]>([]);

  // Nothing in force, so nothing is drawn. The common case by a wide margin.
  if (alerts.length === 0) return null;

  const seen = new Set([...(stored ?? []), ...justRead]);

  const markRead = (id: string): void => {
    // Collapse it as it is marked: leaving it open would hide the very change
    // the tap just made, and the row would look like nothing had happened.
    setOpen(null);
    setJustRead((held) => [...held, id]);
    void localStore().markAlertRead(
      id,
      alerts.map((alert) => alert.id),
    );
  };

  return (
    <View style={styles.strip} testID="weather-alerts">
      {alerts.map((alert) => (
        <AlertRow
          key={alert.id}
          alert={alert}
          open={open === alert.id}
          read={seen.has(alert.id)}
          onPress={() => setOpen(open === alert.id ? null : alert.id)}
          onMarkRead={() => markRead(alert.id)}
        />
      ))}
    </View>
  );
}

function AlertRow({
  alert,
  open,
  read,
  onPress,
  onMarkRead,
}: {
  alert: Alert;
  open: boolean;
  read: boolean;
  onPress: () => void;
  onMarkRead: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const edge = loud(alert.severity) ? colors.rowan : colors.lanternInk;

  /**
   * A read alert is one line, and keeps everything else.
   *
   * The colour stays — a severe warning that has been read is still severe,
   * and the strip must not come to look like a tidy list of things that are
   * over. Only the height goes: the headline, the area and the source note.
   * One tap puts every word of it back.
   */
  const quiet = read && !open;

  return (
    <Touch affordance="disclose"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      // Said as one sentence. A screen reader landing on "Tornado Warning"
      // alone gets the alarm without the where or the when.
      accessibilityLabel={`${alert.event}. ${quiet ? 'Read. ' : `${alert.headline ?? ''} `}${
        open ? '' : 'Tap for the full warning.'
      }`}
      testID={`alert-${alert.id}`}
      style={({ pressed }) => [
        quiet ? styles.quietRow : styles.row,
        {
          backgroundColor: loud(alert.severity) ? colors.alertTint : colors.raised,
          borderColor: edge,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.head}>
        <View style={styles.words}>
          <Text style={[styles.title, quiet && styles.quietTitle, { color: colors.ink }]}>
            {alert.event}
          </Text>
          {quiet || alert.headline === undefined ? null : (
            <Text style={[styles.detail, { color: colors.muted }]}>{alert.headline}</Text>
          )}
          {/**
            * Where it applies, and **not the whole list until it is asked for.**
            *
            * `areaDesc` from the service is every county the product covers,
            * semicolon-separated — nineteen of them on an ordinary Missouri
            * heat warning. Drawn in full it is four lines of place names in
            * the COLLAPSED row, twice over when a watch and a warning are both
            * in force, and it pushed the egg tally off a handset. Reported
            * from a device with exactly that on screen.
            *
            * It is also the least useful thing in the row. A farm knows which
            * county it is in; what it needs from the collapsed state is what
            * the hazard is. The list is still here, in full, one tap away —
            * nothing is thrown out, it is just not shouted.
            */}
          {quiet || alert.area === undefined ? null : (
            <Text style={[styles.where, { color: colors.muted }]}>
              {open ? alert.area : alertCoverage(alert.area)}
            </Text>
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

          {/**
            * At the bottom of the opened row, and nowhere else.
            *
            * Reaching it means having scrolled past the instruction and the
            * description — which is the closest an app can honestly get to
            * "you have read this". A tick on the collapsed row would be a
            * one-thumb reflex beside the tally, and that is the habit the four
            * refusals are about.
            */}
          {read ? null : (
            <Secondary
              label="I have read this"
              onPress={onMarkRead}
              testID={`alert-read-${alert.id}`}
            />
          )}
        </View>
      ) : null}
    </Touch>
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
  /** Read: the same row with the padding of a line rather than of a card. */
  quietRow: {
    gap: SPACE.xs,
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: 2,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md },
  words: { flex: 1, gap: SPACE.xs },
  full: { gap: SPACE.sm },
  title: { fontFamily: FONTS.display, fontSize: TYPE.lede },
  // Still the display face, still the alert's colour — smaller, not quieter.
  quietTitle: { fontSize: TYPE.body },
  instruction: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  detail: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  where: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
});
