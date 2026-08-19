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
} from '@homefarm/contracts';
import { listGroups } from '@homefarm/core/read/groups';
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
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { SPACE } from '../theme/tokens';

/**
 * A set of eggs going under.
 *
 * Its own route rather than a `useState` branch inside the list, for the
 * reason `navigation/Root.tsx` gives at length: a screen that draws a back
 * arrow has to have one that works, and on Android the hardware button has to
 * agree with it. A half-filled form is exactly where that matters.
 *
 * ## Whose eggs, asked at the moment somebody knows
 *
 * `flockId` — *"the group the eggs came from, when they came from this farm"* —
 * has been in the schema since it was written and this screen did not ask, so
 * it could only be filled in afterwards on the edit screen. That is the wrong
 * moment: the person standing at the incubator with a basket knows exactly
 * which birds these came from, and nobody goes back a fortnight later to say.
 *
 * It decides whose story the hatch appears in. `read/history.ts` builds the
 * hatch row from the record and hangs it on the source group as well as the
 * set, so *"the Sussex eggs hatched — 8 chicks"* lands on the hens' own
 * timeline. Without this it reached What happened and no group at all.
 *
 * **Nothing is preselected, even on a farm with one flock.** The same argument
 * `eggsSet` makes below about not opening on a dozen: a default is a number —
 * here a claim — that the app chose, and it would be recorded by anyone who
 * pressed Set them without looking. Saying which birds laid a set is a fact
 * about provenance, and a wrong one is worse than an absent one.
 */

const SOURCE_LABELS = { own: 'My own', bought: 'Bought', gifted: 'Given' } as const;
const METHOD_LABELS = { incubator: 'Incubator', broody: 'Under a broody' } as const;

export function SetEggsScreen(): React.ReactElement {
  const log = useLog();
  const groups = useLive(listGroups);

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
  /** Which of the farm's own birds laid them, when somebody says. */
  const [flockId, setFlockId] = useState<string | null>(null);

  const { saving, failure, save } = useSaver(useLeave());

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
          // Only for an own set: a bought box came from somebody else's birds,
          // and the chips for this are gone the moment the source changes.
          ...(flockId === null || source !== 'own' ? {} : { flockId }),
        },
      });
    });
  }, [save, log, species, label, setAt, eggsSet, source, method, breedId, flockId]);

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

  /**
   * The farm's own groups of this bird, and nothing else.
   *
   * Duck eggs did not come from the goats, and offering every group would make
   * that a tap away. Filtered rather than merely sorted, because a wrong
   * provenance is silent — nothing downstream can tell that the hatch landed on
   * the wrong flock's timeline.
   */
  const layingGroups = (groups ?? []).filter((group) => group.species === species);

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
            // And the same trap for the flock, which is worse because nothing
            // downstream can tell that a hatch landed on the wrong timeline.
            setFlockId(null);
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

      {source === 'own' && layingGroups.length > 0 ? (
        <Field
          label="Which of yours laid them?"
          hint="The hatch shows up on that group’s own story as well as the farm’s."
        >
          <View style={styles.chips}>
            <Chip
              label="Not saying"
              selected={flockId === null}
              testID="incubation-flock-none"
              onPress={() => setFlockId(null)}
            />
            {layingGroups.map((group) => (
              <Chip
                key={group.id}
                label={group.name}
                selected={flockId === group.id}
                testID={`incubation-flock-${group.id}`}
                onPress={() => setFlockId(flockId === group.id ? null : group.id)}
              />
            ))}
          </View>
        </Field>
      ) : null}

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
