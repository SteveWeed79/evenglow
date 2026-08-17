import { useCallback, useState } from 'react';
import { listHarvests, listPlantings, listVarieties } from '@steading/core/read/growing';
import { Confirm, Failure, Field, Primary, TextField, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLeave, useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';

/**
 * Correcting a planting, and taking one back that should not have been made.
 *
 * ## Pulling and removing are different acts, and this screen is the second one
 *
 * `PlantingScreen` already has *pull it* — `removedAt` and a `finished` status,
 * which is what a planting that came to an end **is**. It stays on the bed, it
 * stays in the succession, and everything harvested off it goes on counting.
 * That is the ordinary end of a planting and it is not here.
 *
 * This is the other one: a row planted into the wrong bed, or the same tomatoes
 * entered twice. Archiving (P13) takes it out of every list rather than
 * recording that it ended.
 *
 * ## Which is why a planting with harvests will not be archived
 *
 * A `harvest` names its planting, and `BedScreen` and `VarietyScreen` reach
 * their harvests **through** the plantings — so archiving one takes the food
 * that came off it out of the bed's story and the variety's, while the harvest
 * records themselves sit there untouched and unreachable. Four kilos of
 * tomatoes would stop having happened anywhere a person looks.
 *
 * A planting with harvests against it is not a mistake; it is a planting that
 * fed somebody. The screen says so and offers *pull it* instead.
 */
export function EditPlantingScreen({ route }: ScreenProps<'EditPlanting'>): React.ReactElement {
  const { plantingId } = route.params;
  const nav = useNav();
  const log = useLog();

  const plantings = useLive(listPlantings);
  const varieties = useLive(listVarieties);
  const harvests = useLive(listHarvests);

  const planting = plantings?.find((candidate) => candidate.id === plantingId) ?? null;

  const [edits, setEdits] = useState<{ quantity: number; note: string } | null>(null);

  const { saving, failure, save } = useSaver(useLeave());
  const archived = useSaver(useCallback(() => nav.popTo('Tabs'), [nav]));

  if (plantings === null) return <Loading title="Planting" />;
  if (planting === null) return <Missing title="Planting" what="That planting" />;

  const variety = varieties?.find((candidate) => candidate.id === planting.varietyId);
  const taken = (harvests ?? []).filter((harvest) => harvest.plantingId === plantingId);

  const current = edits ?? { quantity: planting.quantity ?? 0, note: planting.note ?? '' };
  const change = (next: Partial<typeof current>): void => setEdits({ ...current, ...next });

  const commit = (): void => {
    void save(async () => {
      await log({
        entity: 'planting',
        op: 'update',
        targetId: plantingId,
        payload: {
          // Zero is "never counted" rather than a planting of nothing, so it
          // clears rather than storing a nought.
          quantity: current.quantity > 0 ? current.quantity : null,
          note: current.note.trim() === '' ? null : current.note.trim(),
        },
      });
    });
  };

  const archive = (): void => {
    void archived.save(async () => {
      await log({
        entity: 'planting',
        op: 'delete',
        targetId: plantingId,
        payload: { reason: 'Recorded in error' },
      });
    });
  };

  const what = variety?.name ?? 'this planting';

  return (
    <Screen title={`Change ${what}`} back>
      <Field label="How many went in?" hint="Leave it empty if nobody counted.">
        <TextField
          value={current.quantity === 0 ? '' : String(current.quantity)}
          onChangeText={(text) => change({ quantity: Number(text.replace(/\D/g, '')) })}
          keyboardType="number-pad"
          maxLength={7}
          placeholder="24"
          testID="edit-planting-quantity"
        />
      </Field>

      <Field label="Anything worth remembering">
        <TextField
          value={current.note}
          onChangeText={(note) => change({ note })}
          placeholder="From saved seed, second sowing"
          maxLength={1000}
          multiline
          testID="edit-planting-note"
        />
      </Field>

      <Failure message={failure} />

      <Primary label="Save" disabled={saving} onPress={commit} testID="save-planting" />

      <Panel label="Recorded in error?">
        {taken.length > 0 ? (
          <Body>
            {taken.length === 1 ? 'Something has' : `${taken.length} harvests have`} already been
            taken off {what}, so this is not a row entered by mistake. Use{' '}
            <Body>pull it</Body> on the planting itself when it is finished — taking it back out
            would remove what came off it from the bed and the variety, and the harvests
            themselves would still be sitting there.
          </Body>
        ) : (
          <>
            <Body>
              For a row planted into the wrong bed, or the same thing entered twice. A planting
              that simply came to an end wants <Body>pull it</Body> instead, which keeps it in the
              bed&rsquo;s history where it belongs.
            </Body>
            <Failure message={archived.failure} />
            <Confirm
              label="Take it back out"
              armedLabel="Tap again to take it out"
              onConfirm={archive}
              testID="archive-planting"
            />
          </>
        )}
      </Panel>
    </Screen>
  );
}
