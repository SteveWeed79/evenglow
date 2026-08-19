import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CONDITION_WORDS,
  type Condition,
  dayStart,
  fallsAs,
  highLowWords,
  type ForecastDay,
  type ForecastHour,
  degrees,
  forecastFor,
  newId,
  type UnitSystem,
} from '@homefarm/contracts';
import { readSiteOrBlank } from '@homefarm/core/read/growing';
import type { Measured } from '@homefarm/core/weather';
import { Failure, Primary, Secondary, TextField, useSaver } from '../components/Form';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { SKY_MARKS } from '../weather/marks';
import { useLive } from '../hooks/useLive';
import { useWeather } from '../hooks/useWeather';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TAP, TYPE } from '../theme/tokens';
import { locate, findPlace, type Place } from '../weather/where';

/**
 * The forecast in full: the next twenty-four hours by the hour, then seven days.
 *
 * ## What this screen will not do
 *
 * **It does not log weather.** Rain that fell is not a farm record — nobody
 * types it in, it cannot conflict, and a field asking for it would be a chore
 * added to a morning. This is a forecast and only a forecast: something read,
 * never something entered.
 *
 * **It does not promise thirty days.** The National Weather Service publishes
 * about fourteen half-day periods and no more, at any price. Seven days and a
 * day of hours is what there is, and saying so is better than a fortnight of
 * invented numbers. It is also the honest split: "rain from four" changes what
 * somebody does this afternoon, and "week four looks wet" changes nothing
 * anybody can act on.
 *
 * The hourly strip used to stop at midnight, which made it emptier the later it
 * got — four hours at eight o'clock and nothing after eleven. It rolls a full
 * day forward now, because the hour somebody checks a forecast in the dark is
 * the hour they want tonight's low and the morning, not the tail of an
 * afternoon that has already happened.
 *
 * ## Halves that have already happened
 *
 * A forecast day is two NWS periods, and by evening today's daytime half is
 * simply gone. Both temperatures used to be required, so the remaining figure
 * was printed twice and the week read "79° 79°" — see `highLowWords`. Absent is
 * the honest answer, and a lone number is labelled so it reads as the half it
 * is.
 *
 * ## The rain column
 *
 * Chance, not amount. The daily periods carry `probabilityOfPrecipitation` and
 * no quantity — the amounts live in a much larger gridpoint product — and
 * chance is the number a farm acts on anyway: "will I get wet", not "how many
 * millimetres". The bar is there because seven numbers in a column are read one
 * at a time and seven bars are read at once.
 *
 * ## Two ways to say where the farm is, and why the second exists
 *
 * A denied location permission is a dead end for the entire feature, and "open
 * Settings, find the app, find Location" is not an instruction a farm should
 * need. The address search asks the OS for nothing. Both round the position to
 * about a kilometre before it is written — see `roundPosition`.
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function WeatherScreen(): React.ReactElement {
  const { loading, at, placeName, weather, measured, uncovered, fetching, units, again } =
    useWeather();

  return (
    <Screen title="Weather" back wide>
      {loading ? null : at === null ? (
        <WhereIsTheFarm />
      ) : (
        <>
          {uncovered ? (
            <Panel label="Outside the forecast area">
              <Body>
                The forecast comes from the US National Weather Service, which only covers the
                United States and its territories. There is nothing here for this position — the
                rest of the app is unaffected.
              </Body>
            </Panel>
          ) : null}

          {weather === null ? (
            <Panel label={fetching ? 'Asking' : 'Nothing heard yet'}>
              <Body>
                {fetching
                  ? 'Fetching the forecast for the first time.'
                  : 'No forecast has reached this device yet. It will arrive when there is a signal.'}
              </Body>
            </Panel>
          ) : (
            <Forecast
              days={weather.forecast.days}
              hours={weather.forecast.hours}
              nowDeciC={weather.forecast.now.tempDeciC}
              nowCondition={weather.forecast.now.condition}
              measured={measured}
              stale={weather.stale}
              fetchedAt={weather.fetchedAt}
              units={units}
              where={placeName}
            />
          )}

          <Secondary
            label={fetching ? 'Asking…' : 'Ask again'}
            testID="weather-again"
            onPress={again}
          />

          <WhereIsTheFarm again />
        </>
      )}
    </Screen>
  );
}

function Forecast({
  days,
  hours,
  nowDeciC,
  nowCondition,
  measured,
  stale,
  fetchedAt,
  units,
  where,
}: {
  days: readonly ForecastDay[];
  hours: readonly ForecastHour[];
  nowDeciC: number;
  nowCondition: Condition;
  measured: Measured | null;
  stale: boolean;
  fetchedAt: number;
  units: UnitSystem;
  where: string | undefined;
}): React.ReactElement {
  const { colors } = useTheme();
  const now = Date.now();
  const today = forecastFor(days, now);

  /**
   * A measured reading beats the forecast's figure for the hour.
   *
   * Null when no nearby station reports, or when the one that does has gone
   * quiet for ninety minutes. The screen says which of the two it is showing
   * rather than presenting a prediction as a measurement.
   */
  const live = measured !== null && !measured.stale ? measured.observation : null;
  const nowCondition_ = live?.condition ?? nowCondition;

  return (
    <>
      <Panel label={where ?? 'Right now'}>
        <View style={styles.nowRow}>
          <Icon name={SKY_MARKS[nowCondition_]} size={32} color={colors.lanternInk} />
          <Text style={[styles.nowTemp, { color: colors.ink }]}>
            {degrees(live?.tempDeciC ?? nowDeciC, units)}°
          </Text>
          <View style={styles.nowWords}>
            <Text style={[styles.condition, { color: colors.ink }]}>
              {CONDITION_WORDS[nowCondition_]}
            </Text>
            {today === undefined || highLowWords(today, units) === null ? null : (
              <Text style={[styles.label, { color: colors.muted }]}>
                {highLowWords(today, units)}
              </Text>
            )}
          </View>
        </View>

        {/* What it feels like, when the service says the two differ enough to
            matter. A 96° that feels like 108° is a different afternoon. */}
        {live?.feelsLikeDeciC === undefined ||
        Math.abs(live.feelsLikeDeciC - live.tempDeciC) < 20 ? null : (
          <Text style={[styles.label, { color: colors.lanternInk }]} testID="weather-feels">
            Feels like {degrees(live.feelsLikeDeciC, units)}°
          </Text>
        )}

        {/**
          * Where the number came from, and how old it is.
          *
          * A reading measured at an airfield forty miles away twenty-five
          * minutes ago is a different claim from a forecast for this hour, and
          * a farm that can tell them apart can judge them. The alternative —
          * one confident numeral with no provenance — is the thing that makes
          * a fast-moving afternoon look like the app lying.
          */}
        <Text
          style={[styles.age, { color: stale && live === null ? colors.rowan : colors.muted }]}
          testID="weather-age"
        >
          {live === null
            ? stale
              ? `Forecast, last heard ${when(fetchedAt, now)} — too old to trust`
              : `Forecast for this hour · last heard ${when(fetchedAt, now)}`
            : `Measured${live.station === undefined ? '' : ` at ${live.station}`} · ${when(
                live.at,
                now,
              )}`}
        </Text>
      </Panel>

      {hours.length === 0 ? null : (
        <View style={styles.section}>
          {/**
            * "The next while" rather than "the rest of today".
            *
            * The strip stopped at midnight, so it emptied out over the evening
            * and at eight o'clock showed four hours and then nothing —
            * *"it literally stops at 11pm"*. It runs twenty-four hours forward
            * now, which is the half a farm asks about after dark: tonight's low,
            * and what the morning looks like.
            */}
          <Text style={[styles.heading, { color: colors.muted }]}>The next 24 hours</Text>
          {/**
            * Sideways, on one line, and the premise changed under the old note.
            *
            * This used to wrap, on the argument that *a horizontal strip inside
            * a vertical scroll fights the gesture, and with a glove on it
            * loses*. That was written when the strip was whatever was left of
            * today — often four or six cells, one tidy row. It is a full
            * twenty-four now, which wraps to four rows and pushes the week off
            * the screen, so the thing it was protecting is gone either way.
            *
            * The gesture objection is real and is answered rather than ignored:
            * the row is one cell tall, so a drag that starts vertically has
            * almost no chance of landing on it, and React Native picks the
            * responder from the direction the finger actually moves. What is
            * left is a strip that reads left to right like a day does.
            */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hours}
            testID="weather-hours"
          >
            {hours.map((hour, index) => (
              <View key={hour.at} style={styles.hour}>
                {/**
                  * Midnight needs saying, or 2am reads as this afternoon. The
                  * first cell never carries it — "today" above a strip that
                  * starts now is noise.
                  *
                  * ## The row is a fixed height and the text is simply absent
                  *
                  * This used to render the day on **every** cell and paint the
                  * ones with nothing to say `'transparent'`, so all twenty-four
                  * were the same height. Reported from a handset: *"the Day
                  * text on the scrolling hourly weather is impossible to see on
                  * lamplight, the font is black, it's there but not visible."*
                  *
                  * Black on every cell means the inline colour never reached
                  * the `Text` at all — both branches were lost, `'transparent'`
                  * included — and Android's default text colour is black. Why
                  * it was lost is not something the bundler can be made to
                  * show, so the dependency goes instead of being guessed at: a
                  * cell with nothing to say now renders **no text**, and the
                  * heights still line up because the row that holds it has a
                  * height of its own.
                  *
                  * Invisibility that depends on a colour resolving correctly is
                  * invisibility with a failure mode. An element that is not
                  * there has none.
                  */}
                <View style={styles.hourDayRow}>
                  {index > 0 &&
                  dayStart(hour.at) !== dayStart(hours[index - 1]?.at ?? hour.at) ? (
                    /* `inkQuiet`, not brass: this is a label to be read rather
                       than a mark to be noticed, and it is the token that holds
                       R7's 7:1 on all three grounds. Brass is 5.15:1 in
                       daylight, which is a fine bar and a marginal word. */
                    <Text style={[styles.hourDay, { color: colors.inkQuiet }]}>
                      {DAY_NAMES[new Date(hour.at).getDay()]}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.label, { color: colors.muted }]}>{clock(hour.at)}</Text>
                <Icon name={SKY_MARKS[hour.condition]} size={24} color={colors.muted} />
                <Text style={[styles.hourTemp, { color: colors.ink }]}>
                  {degrees(hour.tempDeciC, units)}°
                </Text>
                {/* The same trick and therefore the same trap — a dry hour now
                    renders nothing rather than a percentage painted out. */}
                <View style={styles.hourRainRow}>
                  {hour.rainChance === 0 ? null : (
                    <Text style={[styles.hourRain, { color: colors.lanternInk }]}>
                      {hour.rainChance}%
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.section}>
        <Text style={[styles.heading, { color: colors.muted }]}>The week</Text>
        {days.map((day, index) => {
          // Once per row: the words and the spoken label must not be able to
          // disagree about what is falling.
          const falls = fallsAs(day.condition, day.highDeciC);

          return (
          <View key={day.day} style={styles.day} testID={`weather-day-${index}`}>
            <Text style={[styles.dayName, { color: colors.ink }]}>
              {day.day === dayStart(now) ? 'Today' : DAY_NAMES[new Date(day.day).getDay()]}
            </Text>

            <Icon
              name={SKY_MARKS[day.condition]}
              size={24}
              color={colors.muted}
              label={CONDITION_WORDS[day.condition]}
            />

            {/**
              * Only the halves that were forecast.
              *
              * Today's daytime period is gone by the evening, and printing the
              * remaining figure twice produced the reported "79° 79°" — a real
              * enough looking flat day that nothing on screen could contradict.
              * A lone number is labelled instead, so it reads as the half it is.
              *
              * ## It wrapped as soon as a number needed three digits
              *
              * Reported from the phone: *"the high/low temperatures wrap if the
              * high is 100."* The column was a fixed 76dp, which fits "81° 58°"
              * and nothing longer — so a hundred-degree day, and every
              * below-zero one, folded onto two lines. `-12° -25°` is nine
              * characters and the widest this can ever be asked to draw.
              *
              * It takes the row's spare width now, which is exactly what the
              * rain bar was using before it was cut, and `numberOfLines` makes
              * the refusal to wrap explicit rather than a consequence of the
              * width happening to be enough. Every row flexes identically, so
              * the columns still line up.
              */}
            <Text style={[styles.dayTemps, { color: colors.ink }]} numberOfLines={1}>
              {day.highDeciC === undefined ? null : `${degrees(day.highDeciC, units)}°`}
              {day.lowDeciC === undefined ? null : (
                <Text style={{ color: colors.muted }}>
                  {day.highDeciC === undefined
                    ? `${degrees(day.lowDeciC, units)}° low`
                    : ` ${degrees(day.lowDeciC, units)}°`}
                </Text>
              )}
            </Text>

            {/**
              * The number, and only the number.
              *
              * A brass bar used to sit here, and it was **scaled to the wettest
              * day of the week** rather than to a hundred — so a week topping
              * out at thirty per cent drew a full bar beside the words "30%",
              * and the bar was the one that lied.
              *
              * That relative scale was deliberate: the question a week answers
              * is *which day is the wet one*, not *how close to certain*. But
              * the percentage is printed on every row, so the ranking was
              * already readable, and the bar's only remaining contribution was
              * to contradict it. Asked and answered from the farm: *"cut the
              * bar, the % is enough."*
              *
              * The bar carried the row's accessibility label, so the label
              * moves here rather than leaving a screen reader to announce a
              * bare "30%".
              *
              * ## And the number says what it is a chance of
              *
              * `rainChance` is `probabilityOfPrecipitation`, so a bare "40%"
              * beside a snow mark left a farm to work out which. `fallsAs`
              * decides, once, for everything that shows this — see it for why
              * the high rather than the low breaks the tie.
              *
              * "Rain" and "Snow" rather than "Precipitation", which is the word
              * a forecast office uses and not the one anybody says out loud.
              */}
            <Text
              style={[styles.dayRain, { color: colors.muted }]}
              numberOfLines={1}
              accessibilityLabel={`${day.rainChance} per cent chance of ${falls.toLowerCase()}`}
            >
              {falls} {day.rainChance}%
            </Text>
          </View>
          );
        })}
      </View>
    </>
  );
}

/**
 * Where the farm is — asked once, changed rarely.
 *
 * Rendered as the whole screen before a position is set, and as a quiet
 * secondary underneath the forecast afterwards. Same component, because "set
 * it" and "correct it" are the same act and a second implementation of it is a
 * second place for the rounding to be forgotten.
 */
function WhereIsTheFarm({ again = false }: { again?: boolean }): React.ReactElement {
  const site = useLive(readSiteOrBlank, 'the farm');
  const log = useLog();
  const { colors } = useTheme();

  const [open, setOpen] = useState(!again);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Place[] | null>(null);
  const [refused, setRefused] = useState(false);
  const [searching, setSearching] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);

  const saver = useSaver(useCallback(() => setOpen(false), []));

  /**
   * Writes the position onto the site record, creating one if this farm has
   * never had a site.
   *
   * `update` when there already is one, and that matters more than it looks:
   * `readSite` returns the FIRST site record, so a second `create` would
   * silently become a record nothing reads. A farm that set its position here
   * and its frost dates on the other screen would lose one of the two.
   */
  const put = useCallback(
    async (lat: number, lon: number, name?: string) => {
      if (site === null) return;

      await saver.save(async () => {
        const known = site.id !== '';
        await log({
          entity: 'site',
          op: known ? 'update' : 'create',
          targetId: known ? site.id : newId(),
          payload: {
            ...(known ? {} : { name: site.name === '' ? 'The farm' : site.name }),
            lat,
            lon,
            ...(name === undefined ? {} : { placeName: name }),
          },
        });
      });
    },
    [site, log, saver],
  );

  const useGps = useCallback(async () => {
    setTrouble(null);
    const found = await locate();

    if (found.kind === 'refused') {
      setRefused(true);
      setTrouble('Location is switched off for this app. Type an address instead — it asks the phone for nothing.');
      return;
    }
    if (found.kind === 'unavailable') {
      setTrouble('No fix yet. That is usual indoors — step outside, or type an address.');
      return;
    }

    await put(found.at.lat, found.at.lon);
  }, [put]);

  const search = useCallback(async () => {
    if (query.trim() === '') return;
    setSearching(true);
    setTrouble(null);

    try {
      const matches = await findPlace(query.trim());
      setFound(matches);
      if (matches.length === 0) {
        setTrouble('Nothing matched. A street address works best — the search is a US address lookup, not a map.');
      }
    } catch {
      setTrouble('The address search could not be reached. It needs a signal.');
    } finally {
      setSearching(false);
    }
  }, [query]);

  if (!open) {
    return (
      <Secondary
        label={site?.placeName === undefined ? 'Where is the farm?' : `Where: ${site.placeName}`}
        testID="weather-where"
        onPress={() => setOpen(true)}
      />
    );
  }

  return (
    <>
      <Panel label={again ? 'Move the pin' : 'Where is the farm?'}>
        <Body>
          The forecast needs a position. It is stored rounded to about a kilometre — enough for
          weather, useless for finding a door — and it never leaves this device except as the
          coordinates the forecast is asked for.
        </Body>
      </Panel>

      {refused ? null : (
        <Primary label="Use my location" testID="weather-locate" onPress={() => void useGps()} />
      )}

      <View style={styles.section}>
        <Text style={[styles.heading, { color: colors.muted }]}>Or type an address</Text>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="1 Farm Road, Hollow, VT"
          testID="weather-query"
          accessibilityLabel="The farm's address"
        />
        <Secondary
          label={searching ? 'Looking…' : 'Look it up'}
          testID="weather-search"
          onPress={() => void search()}
        />
      </View>

      {found?.map((place) => (
        <Secondary
          key={`${place.lat},${place.lon}`}
          label={place.name}
          testID={`weather-place-${place.lat},${place.lon}`}
          onPress={() => void put(place.lat, place.lon, place.name)}
        />
      ))}

      {trouble === null ? null : (
        <Panel>
          <Body>{trouble}</Body>
        </Panel>
      )}

      <Failure message={saver.failure} />

      {again ? (
        <Secondary label="Leave it" testID="weather-where-close" onPress={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/** "14:00" in whatever the device calls that. */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric' });
}

/** How long ago, in the words a person would use. */
function when(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const styles = StyleSheet.create({
  section: { gap: SPACE.sm },
  heading: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 0.6,
  },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  nowTemp: { fontFamily: FONTS.display, fontSize: TYPE.hero, fontVariant: ['tabular-nums'] },
  nowWords: { flex: 1, gap: 2 },
  condition: { fontFamily: FONTS.body, fontSize: TYPE.body },
  age: { fontFamily: FONTS.data, fontSize: TYPE.label },
  /**
   * One row, and the padding is what makes the last cell reachable.
   *
   * A horizontal `contentContainerStyle` with no trailing padding puts the
   * twenty-fourth hour flush against the edge of the screen, where a thumb
   * cannot comfortably land on it — the same reason the vertical scroll has a
   * bottom inset.
   */
  hours: { flexDirection: 'row', gap: SPACE.sm, paddingRight: SPACE.lg },
  hour: { alignItems: 'center', gap: 2, minWidth: 56, paddingVertical: SPACE.xs },
  /**
   * The rows that keep the cells the same height whether or not they speak.
   *
   * A cell that only sometimes has a line would be a cell that only sometimes
   * is the same height, and the strip would step up and down across the
   * midnight boundary. That was solved by painting the spare lines
   * `'transparent'`, which put the layout at the mercy of a colour arriving —
   * and on a handset it did not, so twenty-four black day names appeared on a
   * near-black ground.
   *
   * A fixed height holds the row open with nothing in it. `lineHeight` is set
   * on the text to match, so the reserved space is the space the word takes
   * rather than a number that happens to look right on one device.
   */
  hourDayRow: { height: TYPE.label + 2, justifyContent: 'center' },
  hourRainRow: { height: TYPE.label + 3, justifyContent: 'center' },
  hourDay: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label - 2,
    lineHeight: TYPE.label + 2,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  hourTemp: { fontFamily: FONTS.data, fontSize: TYPE.body, fontVariant: ['tabular-nums'] },
  hourRain: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label - 1,
    lineHeight: TYPE.label + 3,
    fontVariant: ['tabular-nums'],
  },
  day: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min - 8,
    paddingHorizontal: SPACE.xs,
  },
  dayName: { fontFamily: FONTS.body, fontSize: TYPE.body, width: 56 },
  /**
   * The flexible column, which is what stops it wrapping.
   *
   * It was a fixed 76dp — enough for "81° 58°" and nothing longer, so a
   * hundred-degree day and every below-zero one folded onto two lines. The bar
   * that used to hold the row's spare width is gone, so this takes it: nine
   * characters of `-12° -25°` fit several times over on any handset.
   *
   * Flex rather than a wider fixed number, because a fixed one is a guess about
   * a font at a text size the reader is allowed to change.
   */
  dayTemps: {
    fontFamily: FONTS.data,
    fontSize: TYPE.body,
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  /**
   * Fixed, and the right-hand column stays the fixed one so the percentages
   * line up under each other — which is the one thing a column of numbers has
   * to do. Wide enough for the longest it can say: "Snow 100%".
   */
  dayRain: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    width: 84,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
