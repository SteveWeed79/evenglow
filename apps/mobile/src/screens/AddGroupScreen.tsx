import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  breedsForSpecies,
  type FlockPurpose,
  formatRange,
  newId,
  purposeGroupsFor,
  purposesFor,
  SPECIES_TRAITS,
  suggestedGrowOutWeeks,
  type Species,
} from '@homefarm/contracts';
import { defaultGroupName } from '@homefarm/core/naming';
import {
  Chip,
  DayPick,
  Failure,
  Field,
  Primary,
  Stepper,
  TextField,
  Toggle,
  useSaver,
} from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useGroups } from '../hooks/useGroups';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * Adds a group of animals.
 *
 * Species chips rather than a picker, grouped so a long list stays scannable
 * at arm's length (UX-SPEC §5). A native picker would be one tap fewer and a
 * modal wheel that cannot be read in sunlight.
 *
 * **Purpose is asked, not inferred.** A hen can lay and can be eaten; which
 * one a keeper intends is a fact about the keeper, and it is what decides
 * whether this group ever gets a processing countdown. Asking here is the only
 * honest place to ask it.
 *
 * **Breed and hatch date are asked for the same reason, and it is a concrete
 * one.** `growOutWindow` and `layOnsetWindow` refuse to guess any of the
 * three: no meat purpose, no birth date or no known breed and they return
 * null. Without these two fields every group in the app was missing two of the
 * three, so the grow-out clock — one of the features that distinguishes this
 * from a spreadsheet — was silent on every farm.
 */

const GROUPINGS = [
  { title: 'Poultry', group: 'poultry' as const },
  { title: 'Ratites', group: 'ratite' as const },
  { title: 'Ruminants', group: 'ruminant' as const },
  { title: 'Other stock', group: 'other' as const },
];

const PURPOSE_LABELS: Record<FlockPurpose, string> = {
  eggs: 'Eggs',
  meat: 'Meat',
  milk: 'Milk',
  fibre: 'Fibre',
  breeding: 'Breeding',
  work: 'Work',
  guarding: 'Guarding',
  companion: 'Pets',
};

export function AddGroupScreen(): React.ReactElement {
  const log = useLog();
  const { groups } = useGroups();
  const { colors } = useTheme();

  const [species, setSpecies] = useState<Species>('chicken');
  const [name, setName] = useState('');
  const [count, setCount] = useState(0);
  const [purposes, setPurposes] = useState<FlockPurpose[]>(['eggs']);
  const [breedId, setBreedId] = useState<string | null>(null);
  const [processAt, setProcessAt] = useState<number | null>(null);
  const [knowsBirth, setKnowsBirth] = useState(false);
  const [bornAt, setBornAt] = useState(() => startOfDay(Date.now()));

  const { saving, failure, save } = useSaver(useLeave());

  const traits = SPECIES_TRAITS[species];
  const breeds = breedsForSpecies(species);
  const chosenBreed = breeds.find((b) => b.id === breedId);
  const suggested = suggestedGrowOutWeeks(breedId ?? undefined);


  /**
   * What this group will be called if nothing is typed — shown as the
   * placeholder, so the field states its own default rather than sitting there
   * looking already answered.
   */
  const suggestedName = defaultGroupName(
    traits.label,
    groups.map((g) => g.name),
  );

  const togglePurpose = useCallback((purpose: FlockPurpose) => {
    setPurposes((current) =>
      current.includes(purpose) ? current.filter((p) => p !== purpose) : [...current, purpose],
    );
  }, []);

  const commit = useCallback(() => {
    void save(async () => {
      await log({
        entity: 'flock',
        op: 'create',
        targetId: newId(),
        payload: {
          name: name.trim() || suggestedName,
          species,
          count,
          ...(purposes.length > 0 ? { purposes } : {}),
          ...(breedId === null ? {} : { breedId }),
          ...(purposes.includes('meat') && processAt !== null
            ? { processAtWeeks: processAt }
            : {}),
          // Hatched or born — NOT when they arrived. The clock counts from the
          // first, and a point-of-lay pullet bought in April would otherwise
          // read as three weeks old.
          ...(knowsBirth ? { bornAt } : {}),
        },
      });
    });
  }, [save, log, name, suggestedName, species, count, purposes, breedId, processAt, knowsBirth, bornAt]);

  return (
    <Screen title="Add stock" back>
      <Text style={[styles.label, { color: colors.muted }]}>What do you keep?</Text>

      {GROUPINGS.map(({ title, group }) => {
        const options = (Object.keys(SPECIES_TRAITS) as Species[]).filter(
          (s) => SPECIES_TRAITS[s].group === group,
        );
        return (
          <View key={group} style={styles.section}>
            <Text style={[styles.groupTitle, { color: colors.muted }]}>{title}</Text>
            <View style={styles.chips}>
              {options.map((option) => (
                <Chip
                  key={option}
                  label={SPECIES_TRAITS[option].label}
                  selected={species === option}
                  onPress={() => {
                    setSpecies(option);
                    // A Rhode Island Red is not a breed of goat. Clearing is
                    // the only honest thing to do with the old choice.
                    setBreedId(null);
                    /**
                     * And a purpose the new species cannot serve goes with it.
                     * Picking goats, ticking milk, then changing to chickens
                     * would otherwise leave "milk" set on a flock of hens —
                     * invisible, because the chip that showed it is gone.
                     */
                    const keeps = new Set(purposesFor(option));
                    setPurposes((current) => current.filter((p) => keeps.has(p)));
                  }}
                />
              ))}
            </View>
          </View>
        );
      })}

      {purposeGroupsFor(species).map((section) => (
        <Field key={section.key} label={section.title} hint={section.hint}>
          <View style={styles.chips}>
            {section.purposes.map((purpose) => (
              <Chip
                key={purpose}
                label={PURPOSE_LABELS[purpose]}
                selected={purposes.includes(purpose)}
                testID={`purpose-${purpose}`}
                onPress={() => togglePurpose(purpose)}
              />
            ))}
          </View>
        </Field>
      ))}

      <Field label={`What are they called? (${traits.collective})`}>
        <TextField
          value={name}
          onChangeText={setName}
          placeholder={suggestedName}
          maxLength={80}
          testID="group-name"
        />
      </Field>

      <Field label="How many?">
        <Stepper value={count} onChange={setCount} steps={[1, 5, 10]} suffix="head" />
      </Field>

      {breeds.length > 0 ? (
        <Field
          label="Which breed? (optional)"
          hint="The library knows how fast each one grows and when it starts to lay."
        >
          <View style={styles.chips}>
            {breeds.map((breed) => (
              <Chip
                key={breed.id}
                label={breed.name}
                selected={breedId === breed.id}
                onPress={() => setBreedId(breedId === breed.id ? null : breed.id)}
              />
            ))}
          </View>
        </Field>
      ) : null}


      {/* Asked only of stock going to the table.
          **The library's figure stands unless somebody changes it.** Storing a
          number here by default would quietly replace "6 to 9 weeks" with a
          single 8 — narrower than the truth, and the farm never asked for it.
          Nothing is written until the override is deliberately turned on. */}
      {purposes.includes('meat') ? (
        suggested !== null && processAt === null ? (
          <Field label="Ready to process at">
            <Body>
              {formatRange(suggested, 'weeks')} old, from the library. The countdown on
              Today is built from that.
            </Body>
            <Toggle
              label="Mine are ready at a different age"
              value={false}
              onChange={() => setProcessAt(Math.round((suggested![0] + suggested![1]) / 2))}
            />
          </Field>
        ) : (
          <Field
            label="Ready to process at"
            hint={
              suggested === null
                ? 'Your own figure — the library has no number for this one.'
                : `The library says ${formatRange(suggested, 'weeks')}. Yours wins.`
            }
          >
            <Stepper
              value={processAt ?? 8}
              onChange={setProcessAt}
              steps={[1, 4]}
              min={1}
              suffix="weeks old"
            />
          </Field>
        )
      ) : null}

      <Toggle
        label="I know when they hatched or were born"
        value={knowsBirth}
        onChange={setKnowsBirth}
      />

      {knowsBirth ? (
        <Field label="Hatched or born">
          <DayPick value={bornAt} onChange={setBornAt} withYear />
        </Field>
      ) : null}

      {/* Says what the two optional answers buy, at the moment they are being
          answered — rather than leaving someone to wonder why a countdown
          never appeared. */}
      {chosenBreed !== undefined && knowsBirth ? (
        <Panel label="What this gives you">
          {chosenBreed.growOutWeeks !== undefined && purposes.includes('meat') ? (
            <Body>
              Ready to process at {formatRange(chosenBreed.growOutWeeks, 'weeks')} old — that
              lands on Today two weeks before.
            </Body>
          ) : null}
          {chosenBreed.layOnsetWeeks !== undefined && purposes.includes('eggs') ? (
            <Body>
              First eggs expected at {formatRange(chosenBreed.layOnsetWeeks, 'weeks')} old.
            </Body>
          ) : null}
        </Panel>
      ) : null}

      <Failure message={failure} />

      <Primary
        label={`Add ${name.trim() || suggestedName}`}
        disabled={saving}
        onPress={commit}
        testID="save-group"
      />
    </Screen>
  );
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const styles = StyleSheet.create({
  section: { gap: SPACE.sm },
  groupTitle: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md },
});
