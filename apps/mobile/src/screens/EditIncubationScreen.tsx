import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  breedsForSpecies,
  candlingDay,
  EGG_SOURCES,
  INCUBATION_DAYS,
  INCUBATION_METHODS,
  laysEggs,
  SPECIES_TRAITS,
  type Species,
} from '@steading/contracts';
import { listIncubations } from '@steading/core/read/breeding';
import { listGroups } from '@steading/core/read/groups';
import {
  Chip,
  Choice,
  Confirm,
  DayPick,
  Failure,
  Field,
  Primary,
  Stepper,
  TextField,
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
 * Correcting a set of eggs, and taking one back out.
 *
 * ## Two of these fields are the app's arithmetic, not description
 *
 * **`setAt` and `species` are where both dates come from.** `incubationDues`
 * counts candling and the hatch off the set date against the species' own
 * length, and `SetEggsScreen` opens on chicken at today — so a duck set entered
 * on the Wednesday it actually went under on the Monday gets a hatch date two
 * days early and a wrong one by a week. There was no way to put either right,
 * and both notices pass silently: a hatch row that came and went is not a row
 * anyone can tell was wrong.
 *
 * **`eggsSet` is the denominator of every rate on the detail screen.** Twelve
 * typed as twenty-one makes a good hatch read as 38%, and that number is what a
 * keeper diagnoses an incubator by.
 *
 * ## And three fields could only be written once
 *
 * `fertile`, `hatched` and `earlyLosses` are recorded by forms that vanish the
 * moment they are filled in — which is right for the detail screen, since a
 * finished step is not a job. It also meant a fat-fingered hatch count was
 * permanent, and the percentage built on it with it. They are offered here, and
 * only once they exist: this screen corrects what was recorded and does not
 * become a second place to record it.
 *
 * ## Where the eggs came from, which nothing could say
 *
 * `flockId` — *"the group the eggs came from, when they came from this farm"* —
 * has been in the schema since it was written and `SetEggsScreen` never asked.
 * It decides whose timeline the hatch appears on, so until this screen a hatch
 * reached What happened and no group's own story, however plainly the hens laid
 * the eggs.
 *
 * ## Taking it out, which costs more here than anywhere else
 *
 * Archived, never deleted (P13), and on every other screen that has meant the
 * record leaves the lists while everything logged against it stays: a retired
 * tractor keeps its hour readings, an archived item keeps its adjustments,
 * because those are separate records that merely name it.
 *
 * **A set of eggs has no separate records.** Its whole history — set, candled,
 * hatched, the counts — is fields on itself, which is exactly why the hatch in
 * What happened is built from the record rather than from a log. So archiving
 * one really does take the hatch out of the farm's history, and the screen says
 * so in those words rather than implying the usual bargain.
 *
 * That is also why it is **allowed** where an archive on a planting with
 * harvests against it is refused. There the harvests would survive, unreachable,
 * saying four kilos of tomatoes had happened somewhere nobody could look; here
 * nothing is stranded, because the row and the record are the same thing. The
 * timeline offers the identical delete on that same row for the same reason.
 */

const SOURCE_LABELS = { own: 'My own', bought: 'Bought', gifted: 'Given' } as const;
const METHOD_LABELS = { incubator: 'Incubator', broody: 'Under a broody' } as const;

export function EditIncubationScreen({
  route,
}: ScreenProps<'EditIncubation'>): React.ReactElement {
  const { incubationId } = route.params;
  const nav = useNav();
  const log = useLog();

  const incubations = useLive(listIncubations);
  const groups = useLive(listGroups);
  const incubation = incubations?.find((candidate) => candidate.id === incubationId) ?? null;

  const [edits, setEdits] = useState<{
    label: string;
    species: Species;
    breedId: string | null;
    eggsSet: number;
    setAt: number;
    source: string;
    method: string;
    flockId: string | null;
    fertile: number;
    hatched: number;
    earlyLosses: number;
    note: string;
  } | null>(null);

  const { saving, failure, save } = useSaver(useLeave());
  const archived = useSaver(useCallback(() => nav.popTo('Tabs'), [nav]));

  if (incubations === null) return <Loading title="Eggs" />;
  if (incubation === null) return <Missing title="Eggs" what="That set of eggs" />;

  const current = edits ?? {
    label: incubation.label,
    species: incubation.species,
    breedId: incubation.breedId ?? null,
    eggsSet: incubation.eggsSet,
    setAt: incubation.setAt,
    source: incubation.source,
    method: incubation.method,
    flockId: incubation.flockId ?? null,
    fertile: incubation.fertile ?? 0,
    hatched: incubation.hatched ?? 0,
    earlyLosses: incubation.earlyLosses ?? 0,
    note: incubation.note ?? '',
  };

  const change = (next: Partial<typeof current>): void => setEdits({ ...current, ...next });

  /** Only the birds, and only the ones the library has a length for. */
  const layers = (Object.keys(SPECIES_TRAITS) as Species[]).filter(
    (s) => laysEggs(s) && INCUBATION_DAYS[s] !== undefined,
  );
  const breeds = breedsForSpecies(current.species);
  const days = INCUBATION_DAYS[current.species] ?? 21;

  /**
   * The farm's own groups of this bird, and nothing else.
   *
   * Duck eggs did not come from the goats. `SetEggsScreen` filters the same
   * way, and the two must agree — a group offered here and not there is a
   * provenance the add screen cannot reproduce.
   */
  const layingGroups = (groups ?? []).filter((group) => group.species === current.species);

  const commit = (): void => {
    void save(async () => {
      await log({
        entity: 'incubation',
        op: 'update',
        targetId: incubationId,
        payload: {
          label: current.label.trim() || incubation.label,
          species: current.species,
          eggsSet: current.eggsSet,
          setAt: current.setAt,
          source: current.source,
          method: current.method,
          // Null where empty, so a breed chosen in error can come off rather
          // than only being swapped for another one.
          breedId: current.breedId,
          flockId: current.flockId,
          note: current.note.trim() === '' ? null : current.note.trim(),
          /**
           * Only the counts that already exist.
           *
           * A set that has not been candled must not gain a `fertile` of nought
           * from a stepper nobody touched — that is a recorded claim that every
           * egg was clear, and `fertilityRate` would print 0%. The steppers for
           * these are not drawn until the step has happened, and the payload
           * agrees with the screen.
           */
          ...(incubation.candledAt === undefined ? {} : { fertile: current.fertile }),
          ...(incubation.hatchedAt === undefined
            ? {}
            : {
                hatched: current.hatched,
                // Zero is "none lost", which is a real answer and the same one
                // an absent field gives — so it clears rather than storing it.
                earlyLosses: current.earlyLosses > 0 ? current.earlyLosses : null,
              }),
        },
      });
    });
  };

  const archive = (): void => {
    void archived.save(async () => {
      await log({
        entity: 'incubation',
        op: 'delete',
        targetId: incubationId,
        payload: {},
      });
    });
  };

  return (
    <Screen title={`Change ${incubation.label}`} back>
      <Field label="What will you call this set?">
        <TextField
          value={current.label}
          onChangeText={(label) => change({ label })}
          maxLength={80}
          testID="edit-incubation-label"
        />
      </Field>

      {/* One of the two fields the dates are computed from. */}
      <Field label="What are they?">
        <Choice
          options={layers}
          value={current.species}
          onChange={(species) =>
            change({
              species,
              // A duck breed left set on a set of chicken eggs would be
              // invisible — the chip that showed it is gone with the species.
              breedId: null,
              /**
               * And the flock, but only when it stops being possible.
               *
               * Blanket-clearing would drop a correct answer: somebody fixing
               * a duck set recorded as chicken has the ducks already selected,
               * and they laid the eggs either way. Dropped only if the group
               * that is selected is not of the new species — which is the case
               * where leaving it would hide a wrong provenance behind a chip
               * that is no longer drawn.
               */
              ...(current.flockId !== null &&
              (groups ?? []).some(
                (group) => group.id === current.flockId && group.species === species,
              )
                ? {}
                : { flockId: null }),
            })
          }
          labels={Object.fromEntries(layers.map((s) => [s, SPECIES_TRAITS[s].label]))}
        />
      </Field>

      {breeds.length > 0 ? (
        <Field
          label="Which breed?"
          hint="It does not change the dates. It is so the app can say when what hatches will start to lay."
        >
          <View style={styles.chips}>
            {breeds.map((breed) => (
              <Chip
                key={breed.id}
                label={breed.name}
                selected={current.breedId === breed.id}
                testID={`edit-incubation-breed-${breed.id}`}
                onPress={() =>
                  change({ breedId: current.breedId === breed.id ? null : breed.id })
                }
              />
            ))}
          </View>
        </Field>
      ) : null}

      <Field label="How many eggs went under?" hint="Every rate on the set is worked out from this.">
        <Stepper
          value={current.eggsSet}
          onChange={(eggsSet) => change({ eggsSet })}
          steps={[1, 6, 12]}
          suffix="eggs"
          testID="eggs"
        />
      </Field>

      <Field label="Set on">
        <DayPick value={current.setAt} onChange={(setAt) => change({ setAt })} />
      </Field>

      {/* Said back, because changing either of the two above moves both dates
          and a person should see where they landed before saving. */}
      <Panel label="Your dates">
        <Body>
          Candle on {when(current.setAt, candlingDay(days))}, hatch about{' '}
          {when(current.setAt, days)}.
        </Body>
      </Panel>

      <Field label="Where did they come from?">
        <Choice
          options={EGG_SOURCES}
          value={current.source}
          onChange={(source) => change({ source })}
          labels={SOURCE_LABELS}
        />
      </Field>

      {/**
        * Whose eggs, when they are this farm's own.
        *
        * Offered only for an own set, because a bought box of eggs came from
        * somebody else's birds and naming one of yours would be false. Absent
        * on a farm with no groups for the same reason the Jobs pin is: a
        * question with one answer is not a question.
        */}
      {current.source === 'own' && layingGroups.length > 0 ? (
        <Field
          label="Which of yours laid them?"
          hint="The hatch shows up on that group’s own story as well as the farm’s."
        >
          <View style={styles.chips}>
            <Chip
              label="Not saying"
              selected={current.flockId === null}
              testID="edit-incubation-flock-none"
              onPress={() => change({ flockId: null })}
            />
            {layingGroups.map((group) => (
              <Chip
                key={group.id}
                label={group.name}
                selected={current.flockId === group.id}
                testID={`edit-incubation-flock-${group.id}`}
                onPress={() => change({ flockId: group.id })}
              />
            ))}
          </View>
        </Field>
      ) : null}

      <Field label="Under what?">
        <Choice
          options={INCUBATION_METHODS}
          value={current.method}
          onChange={(method) => change({ method })}
          labels={METHOD_LABELS}
        />
      </Field>

      {/* The counts that were written once and could never be put right. */}
      {incubation.candledAt === undefined ? null : (
        <Field label="How many were fertile at candling?">
          <Stepper
            value={current.fertile}
            onChange={(fertile) => change({ fertile })}
            steps={[1, 6]}
            suffix="eggs"
            testID="fertile"
          />
        </Field>
      )}

      {incubation.hatchedAt === undefined ? null : (
        <>
          <Field label="How many hatched?">
            <Stepper
              value={current.hatched}
              onChange={(hatched) => change({ hatched })}
              steps={[1, 6]}
              suffix="chicks"
              testID="hatched"
            />
          </Field>
          <Field
            label="Lost in the first days"
            hint="Kept apart from the hatch count on purpose: a bad hatch and a bad brooder are different problems."
          >
            <Stepper
              value={current.earlyLosses}
              onChange={(earlyLosses) => change({ earlyLosses })}
              steps={[1]}
              testID="losses"
            />
          </Field>
        </>
      )}

      <Field label="Anything worth remembering">
        <TextField
          value={current.note}
          onChangeText={(note) => change({ note })}
          placeholder="Ran a degree warm for the first week"
          maxLength={1000}
          multiline
          testID="edit-incubation-note"
        />
      </Field>

      <Failure message={failure} />

      <Primary label="Save" disabled={saving} onPress={commit} testID="save-incubation-edit" />

      <Panel label="Take it back out">
        <Body>
          {incubation.hatchedAt === undefined
            ? 'For a set entered twice, or one that was never actually put under. It stops appearing and stops asking.'
            : 'This one is different from the rest of the app: a set of eggs keeps its whole story on itself, so taking it out takes the hatch out of What happened with it. If the numbers are simply wrong, change them above instead.'}
        </Body>
        <Failure message={archived.failure} />
        <Confirm
          label="Take it out"
          armedLabel="Tap again to take it out"
          onConfirm={archive}
          testID="archive-incubation"
        />
      </Panel>
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

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md },
});
