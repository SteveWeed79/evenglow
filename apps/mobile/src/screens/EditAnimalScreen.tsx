import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SPECIES_TRAITS } from '@homefarm/contracts';
import { listAnimals } from '@homefarm/core/read/animals';
import {
  Chip,
  Confirm,
  DayPick,
  Failure,
  Field,
  Primary,
  TextField,
  Toggle,
  useSaver,
} from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLeave, useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';
import { SPACE } from '../theme/tokens';

/**
 * Changing an animal after she exists, and putting her away.
 *
 * ## The gap, and how large it was
 *
 * `DESIGN-BRIEF.md` calls the edit half of the UI the largest gap in the
 * product: sixteen entities are mutable in the contract and the app could
 * change one of them. A doe's tag was whatever was typed the first time. A ram
 * bought as "male" and recorded as female stayed female, and `possibleDams`
 * offered him for breeding for ever, because sex is what decides that.
 *
 * ## Clearing works here, and that is new
 *
 * A tag can be taken off now, not merely replaced. `contracts/clearing.ts` gave
 * the wire a `null` meaning *remove this*, so the fields below send their
 * cleared state and it survives the journey — before that they could be set and
 * changed and never emptied, which on a tag means a band that came off stayed
 * in the record for ever.
 *
 * ## Putting her away, and what it does not claim
 *
 * Archived, never deleted (P13): the weights, the worming, the treatments and
 * the matings all stay, and she stops appearing in the list. **It records that
 * she is gone and not why**, and the copy says so rather than implying a sale
 * or a death has been logged. §4's adaptable outcome flow is what will ask —
 * sold, culled, died, moved — and because nothing here is deleted, the record
 * is still there for it to attach an answer to.
 *
 * Until then, a farm that cannot remove a sold doe keeps her on the list for
 * ever, which is the worse of the two silences.
 */
export function EditAnimalScreen({ route }: ScreenProps<'EditAnimal'>): React.ReactElement {
  const { animalId } = route.params;
  const nav = useNav();
  const log = useLog();

  const animals = useLive(listAnimals);
  const animal = animals?.find((candidate) => candidate.id === animalId) ?? null;

  const [edits, setEdits] = useState<{
    name: string;
    tag: string;
    breed: string;
    sex: 'female' | 'male' | 'unknown';
    bornAt: number | null;
    note: string;
  } | null>(null);

  const { saving, failure, save } = useSaver(useLeave());

  /**
   * Out to the tabs rather than back one.
   *
   * The screen behind is about an animal that no longer appears anywhere, so
   * `goBack()` would land on one that immediately says it cannot find her.
   * Same reasoning as `EditGroupScreen`.
   */
  const archived = useSaver(useCallback(() => nav.popTo('Tabs'), [nav]));

  if (animals === null) return <Loading title="Animal" />;
  if (animal === null) return <Missing title="Animal" what="That animal" />;

  // Seeded on first render rather than in an effect, which would paint one
  // frame of empty fields over an animal that has a name.
  const current = edits ?? {
    name: animal.name,
    tag: animal.tag ?? '',
    breed: animal.breed ?? '',
    sex: animal.sex ?? 'unknown',
    bornAt: animal.bornAt ?? null,
    note: animal.note ?? '',
  };

  const change = (next: Partial<typeof current>): void => setEdits({ ...current, ...next });

  const commit = (): void => {
    void save(async () => {
      await log({
        entity: 'animal',
        op: 'update',
        targetId: animalId,
        payload: {
          name: current.name.trim() || animal.name,
          sex: current.sex,
          /**
           * Named with `null` where it is now empty, never omitted.
           *
           * An update merges on both sides, so a field left out keeps its old
           * value — which is how a tag that came off stayed in the record. The
           * wire has a word for cleared now (`contracts/clearing.ts`), and
           * these are the fields that need it.
           */
          tag: current.tag.trim() === '' ? null : current.tag.trim(),
          breed: current.breed.trim() === '' ? null : current.breed.trim(),
          note: current.note.trim() === '' ? null : current.note.trim(),
          bornAt: current.bornAt,
        },
      });
    });
  };

  const archive = (): void => {
    void archived.save(async () => {
      await log({
        entity: 'animal',
        op: 'delete',
        targetId: animalId,
        payload: { reason: 'Put away from the app' },
      });
    });
  };

  const traits = SPECIES_TRAITS[animal.species];

  return (
    <Screen title={`Change ${animal.name}`} back>
      <Field label="What do you call her?">
        <TextField
          value={current.name}
          onChangeText={(name) => change({ name })}
          maxLength={80}
          testID="edit-animal-name"
        />
      </Field>

      <Field label="Tag or band" hint="Leave it empty if the band has come off.">
        <TextField
          value={current.tag}
          onChangeText={(tag) => change({ tag })}
          placeholder="Blue 07"
          maxLength={40}
          testID="edit-animal-tag"
        />
      </Field>

      <Field label="Breed">
        <TextField
          value={current.breed}
          onChangeText={(breed) => change({ breed })}
          placeholder={traits.singular}
          maxLength={80}
          testID="edit-animal-breed"
        />
      </Field>

      {/* Sex is not cosmetic: `possibleDams` reads it, so a ram recorded female
          is offered for breeding until somebody can change this. */}
      <Field label="Sex" hint="This is what decides whether she can be recorded as in kid.">
        <View style={styles.chips}>
          {(['female', 'male', 'unknown'] as const).map((option) => (
            <Chip
              key={option}
              label={option === 'unknown' ? 'Not sure' : option === 'female' ? 'Female' : 'Male'}
              selected={current.sex === option}
              testID={`sex-${option}`}
              onPress={() => change({ sex: option })}
            />
          ))}
        </View>
      </Field>

      <Toggle
        label="I know when she was born"
        value={current.bornAt !== null}
        onChange={(known) => change({ bornAt: known ? startOfDay(Date.now()) : null })}
      />

      {current.bornAt === null ? null : (
        <Field label="Born">
          <DayPick value={current.bornAt} onChange={(bornAt) => change({ bornAt })} withYear />
        </Field>
      )}

      <Field label="Anything worth remembering">
        <TextField
          value={current.note}
          onChangeText={(note) => change({ note })}
          placeholder="Kids easily, hates the trailer"
          maxLength={500}
          multiline
          testID="edit-animal-note"
        />
      </Field>

      <Failure message={failure} />

      <Primary label="Save" disabled={saving} onPress={commit} testID="save-animal" />

      <Panel label="Put her away">
        <Body>
          Everything logged about {animal.name} stays — her weights, her treatments, her matings.
          She stops appearing in the list.
        </Body>
        {/* Said plainly, because the app cannot tell these apart and should not
            pretend to. Recording what actually happened is its own thing and
            is not built yet. */}
        <Body>
          This records that she is gone, not why. Sold, culled or died is not something the app
          can ask yet.
        </Body>
        <Failure message={archived.failure} />
        <Confirm
          label="Put her away"
          armedLabel="Tap again to put her away"
          onConfirm={archive}
          testID="archive-animal"
        />
      </Panel>
    </Screen>
  );
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
});
