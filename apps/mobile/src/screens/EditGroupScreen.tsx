import { useCallback, useState } from 'react';
import {
  breedsForSpecies,
  type FlockPurpose,
  formatRange,
  purposeGroupsFor,
  suggestedGrowOutWeeks,
} from '@steading/contracts';
import { listGroups } from '@steading/core/read/groups';
import {
  Chip,
  Confirm,
  DayPick,
  Failure,
  Field,
  Primary,
  Stepper,
  TextField,
  Toggle,
  useSaver,
} from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';
import { StyleSheet, View } from 'react-native';
import { SPACE } from '../theme/tokens';

/**
 * Changing a group after it exists.
 *
 * Head count moves constantly — birds are added, animals are sold, a loss is
 * recorded — and until this screen there was no way to change it, so a farm's
 * numbers were correct on the day the group was created and wrong from then
 * on. Purposes matter for the same reason: the grow-out clock is silent unless
 * the group says it is kept for meat, and nobody picks their purposes right on
 * the first screen they ever see.
 *
 * **Archived, never deleted (P13).** `delete` on a mutable entity sets
 * `archivedAt` server-side; the eggs, treatments and withdrawal history stay,
 * because those records are the reason the group was worth keeping. What
 * disappears is the group from the list, which is the only thing anyone meant.
 */

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

export function EditGroupScreen({ route }: ScreenProps<'EditGroup'>): React.ReactElement {
  const { groupId } = route.params;
  const nav = useNav();
  const log = useLog();

  const groups = useLive(listGroups);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const [edits, setEdits] = useState<{
    name: string;
    count: number;
    purposes: FlockPurpose[];
    breedId: string | null;
    bornAt: number | null;
    processAtWeeks: number | null;
  } | null>(null);

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  /**
   * Back to the tabs rather than to this screen's parent.
   *
   * The group hub behind it is about a group that no longer exists, so
   * `goBack()` would land on a screen that immediately says it cannot find
   * anything. Popping the whole way out is the honest answer.
   */
  const archived = useSaver(useCallback(() => nav.popTo('Tabs'), [nav]));

  if (groups === null) return <Loading title="Group" />;
  if (group === null) return <Missing title="Group" what="That group" />;

  // Seeded from the record on first render rather than in an effect: an effect
  // would paint one frame of empty fields over a group that has a name.
  const current = edits ?? {
    name: group.name,
    count: group.count,
    purposes: (group.purposes ?? []) as FlockPurpose[],
    breedId: group.breedId ?? null,
    bornAt: group.bornAt ?? null,
    processAtWeeks: group.processAtWeeks ?? null,
  };

  const breeds = breedsForSpecies(group.species);
  const suggested = suggestedGrowOutWeeks(current.breedId ?? undefined);

  const change = (next: Partial<typeof current>) => setEdits({ ...current, ...next });

  const commit = () => {
    void save(async () => {
      await log({
        entity: 'flock',
        op: 'update',
        targetId: groupId,
        payload: {
          name: current.name.trim() || group.name,
          count: current.count,
          ...(current.purposes.length > 0 ? { purposes: current.purposes } : {}),
          ...(current.breedId === null ? {} : { breedId: current.breedId }),
          ...(current.bornAt === null ? {} : { bornAt: current.bornAt }),
          ...(current.purposes.includes('meat') && current.processAtWeeks !== null
            ? { processAtWeeks: current.processAtWeeks }
            : {}),
        },
      });
    });
  };

  const archive = () => {
    void archived.save(async () => {
      await log({
        entity: 'flock',
        op: 'delete',
        targetId: groupId,
        payload: { reason: 'Put away from the app' },
      });
    });
  };

  return (
    <Screen title={`Change ${group.name}`} back>
      <Field label="What are they called?">
        <TextField
          value={current.name}
          onChangeText={(name) => change({ name })}
          maxLength={80}
          testID="edit-name"
        />
      </Field>

      <Field label="How many now?">
        <Stepper
          value={current.count}
          onChange={(count) => change({ count })}
          steps={[1, 5, 10]}
          suffix="head"
        />
      </Field>

      {purposeGroupsFor(group.species).map((section) => (
        <Field key={section.key} label={section.title} hint={section.hint}>
          <View style={styles.chips}>
            {section.purposes.map((purpose) => (
              <Chip
                key={purpose}
                label={PURPOSE_LABELS[purpose]}
                selected={current.purposes.includes(purpose)}
                testID={`purpose-${purpose}`}
                onPress={() => change({
                    purposes: current.purposes.includes(purpose)
                      ? current.purposes.filter((p) => p !== purpose)
                      : [...current.purposes, purpose],
                  })}
              />
            ))}
          </View>
        </Field>
      ))}

      {breeds.length > 0 ? (
        <Field
          label="Which breed?"
          hint="The library knows how fast each one grows and when it starts to lay — that is where the countdowns come from."
        >
          <View style={styles.chips}>
            {breeds.map((breed) => (
              <Chip
                key={breed.id}
                label={breed.name}
                selected={current.breedId === breed.id}
                onPress={() =>
                  change({ breedId: current.breedId === breed.id ? null : breed.id })
                }
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
      {current.purposes.includes('meat') ? (
        suggested !== null && current.processAtWeeks === null ? (
          <Field label="Ready to process at">
            <Body>
              {formatRange(suggested, 'weeks')} old, from the library. The countdown on
              Today is built from that.
            </Body>
            <Toggle
              label="Mine are ready at a different age"
              value={false}
              onChange={() =>
                change({ processAtWeeks: Math.round((suggested[0] + suggested[1]) / 2) })
              }
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
              value={current.processAtWeeks ?? 8}
              onChange={(processAtWeeks: number) => change({ processAtWeeks })}
              steps={[1, 4]}
              min={1}
              suffix="weeks old"
            />
          </Field>
        )
      ) : null}

      <Toggle
        label="I know when they hatched or were born"
        value={current.bornAt !== null}
        onChange={(known) => change({ bornAt: known ? startOfDay(Date.now()) : null })}
      />

      {current.bornAt === null ? null : (
        <Field label="Hatched or born">
          <DayPick value={current.bornAt} onChange={(bornAt) => change({ bornAt })} withYear />
        </Field>
      )}

      <Failure message={failure} />

      <Primary label="Save" disabled={saving} onPress={commit} testID="save-group" />

      <Panel label="Put this group away">
        <Body>
          Everything you have logged about {group.name} stays — the eggs, the treatments, the
          withdrawal history. It just stops appearing in your lists.
        </Body>
        <Failure message={archived.failure} />
        <Confirm
          label="Put it away"
          armedLabel="Tap again to put it away"
          onConfirm={archive}
          testID="archive-group"
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md },
});
