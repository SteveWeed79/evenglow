import { StyleSheet, Text } from 'react-native';
import { formatTemperature } from '@steading/contracts';
import {
  listBeds,
  listPlantings,
  listVarieties,
  type Planting,
} from '@steading/core/read/growing';
import { Row } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Timeline } from '../components/Timeline';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useUnits } from '../hooks/useUnits';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * One variety, what it needs, and how it has done here.
 *
 * ## The question this answers, which nothing could
 *
 * A farm copies a variety out of the library or invents one, plants it for
 * three seasons, and has no way to ask *"how did Roma do for us?"* — the
 * numbers that decided the planting dates were in the record and never shown,
 * and the harvests were tied to plantings nobody could aggregate.
 *
 * Like `BedScreen` and unlike the animal one: **nothing append-only names a
 * variety.** A `harvest` names its planting. So the yield arrives by asking for
 * this variety *and every planting of it* by name — the hop made on the screen
 * that means it, per `HistoryScope`.
 *
 * ## The library's numbers, shown rather than merely used
 *
 * `daysToMaturity` and the sowing offsets drive every planned date the growing
 * screens produce, and a farm was told those dates mattered without ever being
 * shown what they were computed from. A keeper who disagrees with sixty-five
 * days has to see sixty-five days first.
 */
export function VarietyScreen({ route }: ScreenProps<'Variety'>): React.ReactElement {
  const { varietyId } = route.params;
  const nav = useNav();
  const { colors } = useTheme();
  const units = useUnits();

  const varieties = useLive(listVarieties);
  const plantings = useLive(listPlantings);
  const beds = useLive(listBeds);

  const variety = varieties?.find((candidate) => candidate.id === varietyId) ?? null;

  if (varieties === null) return <Loading title="Variety" />;
  if (variety === null) return <Missing title="Variety" what="That variety" />;

  const mine = (plantings ?? [])
    .filter((planting) => planting.varietyId === varietyId)
    .sort((a, b) => b.season - a.season);

  const bedName = new Map((beds ?? []).map((bed) => [bed.id, bed.name]));
  const seasons = new Set(mine.map((planting) => planting.season));

  /** The variety and every planting of it — see the note above about the hop. */
  const subjects = [varietyId, ...mine.map((planting) => planting.id)];

  return (
    <Screen title={variety.name} back>
      <Text style={[styles.identity, { color: colors.muted }]} testID="variety-identity">
        {variety.crop}
      </Text>

      {/*
        What the app's own dates are computed from. Shown as sentences rather
        than a table of fields, because a farm reads these to decide whether to
        trust a sowing date rather than to look one up.
      */}
      <Panel label="What it asks for">
        {variety.daysToMaturity === undefined ? null : (
          <Body>Ready about {variety.daysToMaturity} days after it goes in.</Body>
        )}
        {variety.startIndoorsWeeksBefore === undefined ? null : (
          <Body>
            Started indoors about {variety.startIndoorsWeeksBefore} weeks before the last frost.
          </Body>
        )}
        {variety.directSowWeeksAfter === undefined ? null : (
          <Body>Sown straight out about {variety.directSowWeeksAfter} weeks after it.</Body>
        )}
        {variety.hardyToDeciC === undefined ? null : (
          <Body>Takes cold down to about {formatTemperature(variety.hardyToDeciC, units)}.</Body>
        )}
        {variety.daysToMaturity === undefined &&
        variety.startIndoorsWeeksBefore === undefined &&
        variety.directSowWeeksAfter === undefined &&
        variety.hardyToDeciC === undefined ? (
          <Body>
            Nothing recorded about how it grows, so the app cannot suggest dates for it — you can
            still plant it and record what happens.
          </Body>
        ) : null}
      </Panel>

      {variety.note === undefined ? null : (
        <Panel label="Noted">
          <Body>{variety.note}</Body>
        </Panel>
      )}

      <Panel
        label={
          mine.length === 0
            ? 'Never planted'
            : `Planted ${seasons.size === 1 ? 'one season' : `across ${seasons.size} seasons`}`
        }
      >
        {mine.length === 0 ? (
          <Body>
            Not in the ground yet. Plant it in a bed and this fills in with where it went and what
            came off it.
          </Body>
        ) : (
          mine.slice(0, 8).map((planting) => (
            <Row
              key={planting.id}
              title={bedName.get(planting.bedId) ?? 'A bed no longer listed'}
              detail={`${planting.season}${whereItGot(planting)}`}
              testID={`planting-${planting.id}`}
              onPress={() => nav.navigate('Planting', { plantingId: planting.id })}
            />
          ))
        )}
      </Panel>

      <Panel label="This variety">
        <Row
          title={`Change ${variety.name}`}
          detail="Its name, the crop, and how long it takes"
          testID="go-edit-variety"
          onPress={() => nav.navigate('EditVariety', { varietyId })}
        />
      </Panel>

      <Timeline subject={subjects} label="What it has given" />
    </Screen>
  );
}

/** Whether it is still in the ground, said after the season rather than instead. */
function whereItGot(planting: Planting): string {
  if (planting.removedAt !== undefined) return ' · finished';
  if (planting.status === 'failed') return ' · failed';
  return '';
}

const styles = StyleSheet.create({
  identity: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 0.4,
    paddingHorizontal: SPACE.md,
  },
});
