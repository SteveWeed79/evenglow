import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  breedsForSpecies,
  candlingDay,
  EGG_SOURCES,
  INCUBATION_DAYS,
  INCUBATION_METHODS,
  laysEggs,
  newId,
  SPECIES_TRAITS,
  type Species,
} from '@steading/contracts';
import {
  Chip,
  Choice,
  DayPick,
  Failure,
  Field,
  Primary,
  Stepper,
  TextField,
  useSaver,
} from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { SPACE } from '../theme/tokens';

/**
 * A set of eggs going under.
 *
 * Its own route rather than a `useState` branch inside the list, for the
 * reason `navigation/Root.tsx` gives at length: a screen that draws a back
 * arrow has to have one that works, and on Android the hardware button has to
 * agree with it. A half-filled form is exactly where that matters.
 */

const SOURCE_LABELS = { own: 'My own', bought: 'Bought', gifted: 'Given' } as const;
const METHOD_LABELS = { incubator: 'Incubator', broody: 'Under a broody' } as const;

export function SetEggsScreen(): React.ReactElement {
  const nav = useNav();
  const log = useLog();

  const [label, setLabel] = useState('');
  const [species, setSpecies] = useState<Species>('chicken');
  /**
   * Zero rather than a dozen.
   *
   * Twelve is the commonest clutch and it was there as a kindness, but it is
   * still a number the app picked and it would be recorded by anyone who
   * pressed Set them without looking. `+12` is one tap for the common case,
   * which is the whole cost of asking.
   */
  const [eggsSet, setEggsSet] = useState(0);
  const [setAt, setSetAt] = useState(() => startOfDay(Date.now()));
  const [source, setSource] = useState<(typeof EGG_SOURCES)[number]>('own');
  const [method, setMethod] = useState<(typeof INCUBATION_METHODS)[number]>('incubator');
  const [breedId, setBreedId] = useState<string | null>(null);

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const commit = useCallback(() => {
    void save(async () => {
      await log({
        entity: 'incubation',
        op: 'create',
        targetId: newId(),
        payload: {
          species,
          label: label.trim() || `${SPECIES_TRAITS[species].label} set`,
          setAt,
          eggsSet,
          source,
          method,
          ...(breedId === null ? {} : { breedId }),
        },
      });
    });
  }, [save, log, species, label, setAt, eggsSet, source, method, breedId]);

  /** Only the birds. A goat cannot be set under a broody. */
  const layers = (Object.keys(SPECIES_TRAITS) as Species[]).filter(
    (s) => laysEggs(s) && INCUBATION_DAYS[s] !== undefined,
  );
  const days = INCUBATION_DAYS[species] ?? 21;

  /**
   * Deliberately not filtered any further than by species.
   *
   * A set of eggs is not yet a flock and nobody has decided what these birds
   * are for, so narrowing by purpose the way the group screen does would be
   * guessing at a decision that has not been made.
   */
  const breeds = breedsForSpecies(species);

  return (
    <Screen title="Set some eggs" back>
      <Field label="What are they?">
        <Choice
          options={layers}
          value={species}
          onChange={(next) => {
            setSpecies(next);
            // A duck breed left set on a set of chicken eggs would be
            // invisible — the chip that showed it is gone with the species.
            setBreedId(null);
          }}
          labels={Object.fromEntries(layers.map((s) => [s, SPECIES_TRAITS[s].label]))}
        />
      </Field>

      {breeds.length > 0 ? (
        <Field
          label="Which breed? (optional)"
          hint="It does not change the dates — every chicken egg is 21 days. It is so the app can say when what hatches will start to lay."
        >
          <View style={styles.chips}>
            {breeds.map((breed) => (
              <Chip
                key={breed.id}
                label={breed.name}
                selected={breedId === breed.id}
                testID={`incubation-breed-${breed.id}`}
                onPress={() => setBreedId(breedId === breed.id ? null : breed.id)}
              />
            ))}
          </View>
        </Field>
      ) : null}

      <Field label="What will you call this set?">
        <TextField
          value={label}
          onChangeText={setLabel}
          placeholder={`${SPECIES_TRAITS[species].label} set`}
          maxLength={80}
          testID="incubation-label"
        />
      </Field>

      <Field label="How many eggs?">
        <Stepper value={eggsSet} onChange={setEggsSet} steps={[1, 6, 12]} suffix="eggs" />
      </Field>

      <Field label="Set on">
        <DayPick value={setAt} onChange={setSetAt} />
      </Field>

      <Field label="Where did they come from?">
        <Choice options={EGG_SOURCES} value={source} onChange={setSource} labels={SOURCE_LABELS} />
      </Field>

      <Field label="Under what?">
        <Choice
          options={INCUBATION_METHODS}
          value={method}
          onChange={setMethod}
          labels={METHOD_LABELS}
        />
      </Field>

      <Panel label="Your dates">
        <Body>
          Candle on {when(setAt, candlingDay(days))}, hatch about {when(setAt, days)}. Both land
          on Today by themselves — the candling two days before, the hatch three weeks before,
          because one is a job and the other is a thing to be ready for.
        </Body>
      </Panel>

      <Failure message={failure} />

      <Primary label="Set them" disabled={saving || eggsSet === 0} onPress={commit} testID="save-incubation" />
    </Screen>
  );
}

const DAY_MS = 86_400_000;

function when(from: number, days: number): string {
  return new Date(from + days * DAY_MS).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md },
});
