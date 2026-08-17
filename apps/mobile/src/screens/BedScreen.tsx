import { StyleSheet, Text } from 'react-native';
import {
  listBeds,
  listPlantings,
  listVarieties,
  occupants,
  type Planting,
} from '@steading/core/read/growing';
import { Row } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Timeline } from '../components/Timeline';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * One bed, what is in it, and what has been in it.
 *
 * ## Why this screen is not shaped like the others
 *
 * The animal and machine screens lead with a timeline because the records that
 * matter name them directly. **Nothing append-only names a bed.** A `harvest`
 * names its *planting*; a planting names the bed. So a bed's own timeline is
 * empty by construction, and a screen built to the same pattern would say
 * "nothing logged against this yet" for ever on a bed that had fed a family
 * all summer.
 *
 * What a bed actually is, is a **succession**: what is growing now, and what
 * grew before. That comes from `planting` — a mutable record of state rather
 * than an event, which is exactly why the history projection excludes it and
 * why this screen has to read it directly.
 *
 * ## The hop, made here rather than in the read
 *
 * The harvests still belong on this screen, and they arrive by the bed asking
 * for **itself and its plantings** by name (`HistoryScope`). That keeps
 * `read/history.ts` strict about subjects being what a record names, and puts
 * the one inference in the file that means it: *"we took four kilos out of bed
 * three in August"* is a true sentence about the bed, and this is where
 * somebody decided so.
 *
 * ## What it does not do yet
 *
 * No rotation advice. `useRotation` already answers what should follow what,
 * and putting it here before it has been designed onto a screen would be
 * guessing at a feature that has a plan of its own. Changing the bed and
 * taking it out of use are one row down, on `EditBedScreen`.
 */
export function BedScreen({ route }: ScreenProps<'Bed'>): React.ReactElement {
  const { bedId } = route.params;
  const nav = useNav();
  const { colors } = useTheme();

  const beds = useLive(listBeds);
  const plantings = useLive(listPlantings);
  const varieties = useLive(listVarieties);

  const bed = beds?.find((candidate) => candidate.id === bedId) ?? null;

  if (beds === null) return <Loading title="Bed" />;
  if (bed === null) return <Missing title="Bed" what="That bed" />;

  const all = (plantings ?? []).filter((planting) => planting.bedId === bedId);
  const growing = occupants(all, bedId);
  const finished = all
    .filter((planting) => !growing.includes(planting))
    .sort((a, b) => sownWhen(b) - sownWhen(a));

  const named = new Map((varieties ?? []).map((variety) => [variety.id, variety.name]));
  const nameOf = (planting: Planting): string =>
    named.get(planting.varietyId) ?? 'Something no longer in the list';

  /**
   * The bed and everything that has grown in it.
   *
   * Every planting, not only the current ones: a harvest taken off last year's
   * tomatoes is part of this bed's story, and dropping the finished plantings
   * would quietly shorten it each time something was pulled.
   */
  const subjects = [bedId, ...all.map((planting) => planting.id)];

  return (
    <Screen title={bed.name} back>
      <Text style={[styles.identity, { color: colors.muted }]} testID="bed-identity">
        {bed.covered ? 'Under cover' : 'Open ground'}
      </Text>

      {bed.note === undefined ? null : (
        <Panel label="Noted">
          <Body>{bed.note}</Body>
        </Panel>
      )}

      <Panel label={growing.length === 0 ? 'Empty' : 'Growing here now'}>
        {growing.length === 0 ? (
          <Body>
            Nothing in it. An empty bed in spring is a decision waiting to be made; in autumn it
            is a bed doing its job.
          </Body>
        ) : (
          growing.map((planting) => (
            <Row
              key={planting.id}
              title={nameOf(planting)}
              detail={plantedWhen(planting)}
              testID={`growing-${planting.id}`}
              onPress={() => nav.navigate('Planting', { plantingId: planting.id })}
            />
          ))
        )}
      </Panel>

      {/*
        What grew here before, which is the question a bed is actually asked.
        Rotation, disease and "what did well here" all start from it, and until
        this screen the answer lived only in records nothing displayed.
      */}
      {finished.length === 0 ? null : (
        <Panel label="Grown here before">
          {finished.slice(0, 8).map((planting) => (
            <Row
              key={planting.id}
              title={nameOf(planting)}
              detail={`${planting.season}`}
              testID={`grown-${planting.id}`}
              onPress={() => nav.navigate('Planting', { plantingId: planting.id })}
            />
          ))}
        </Panel>
      )}

      <Panel label="This bed">
        <Row
          title={`Change ${bed.name}`}
          detail="Its name, whether it is under cover, and taking it out of use"
          testID="go-edit-bed"
          onPress={() => nav.navigate('EditBed', { bedId })}
        />
      </Panel>

      <Timeline subject={subjects} label="What came out of it" />
    </Screen>
  );
}

/** The day something went in, by whichever route it got there. */
function sownWhen(planting: Planting): number {
  return planting.sownAt ?? planting.transplantedAt ?? planting.startedIndoorsAt ?? 0;
}

/** When it went in, in words, or what it is waiting for. */
function plantedWhen(planting: Planting): string {
  const at = sownWhen(planting);
  if (at === 0) return 'Planned';

  return `In since ${new Date(at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  })}`;
}

const styles = StyleSheet.create({
  identity: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 0.4,
    paddingHorizontal: SPACE.md,
  },
});
