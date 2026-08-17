import { useCallback, useState } from 'react';
import { listBeds, listPlantings, occupants } from '@steading/core/read/growing';
import {
  Confirm,
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

/**
 * Changing a bed, and taking one out of use.
 *
 * A bed was named once and never again. That matters more than it sounds:
 * `covered` is not a label — it drives the frost warning, so a tunnel recorded
 * as open ground raises frost alarms all spring for plants that are not in any
 * danger, and a farm learns to ignore the one warning this app most needs
 * somebody to read.
 *
 * ## Putting it away when something is still in it
 *
 * Refused, and this is the one guard worth having here. A bed with a crop in it
 * is a bed the farm is still using; archiving it would take the plantings off
 * every growing screen while they are still in the ground, and the harvest that
 * follows would have nowhere to be logged. The plantings are the thing to
 * finish, and the screen says which rather than merely refusing.
 */
export function EditBedScreen({ route }: ScreenProps<'EditBed'>): React.ReactElement {
  const { bedId } = route.params;
  const nav = useNav();
  const log = useLog();

  const beds = useLive(listBeds);
  const plantings = useLive(listPlantings);
  const bed = beds?.find((candidate) => candidate.id === bedId) ?? null;

  const [edits, setEdits] = useState<{ name: string; covered: boolean; note: string } | null>(null);

  const { saving, failure, save } = useSaver(useLeave());
  const archived = useSaver(useCallback(() => nav.popTo('Tabs'), [nav]));

  if (beds === null) return <Loading title="Bed" />;
  if (bed === null) return <Missing title="Bed" what="That bed" />;

  const current = edits ?? {
    name: bed.name,
    covered: bed.covered,
    note: bed.note ?? '',
  };

  const change = (next: Partial<typeof current>): void => setEdits({ ...current, ...next });

  const growing = occupants(plantings ?? [], bedId);

  const commit = (): void => {
    void save(async () => {
      await log({
        entity: 'bed',
        op: 'update',
        targetId: bedId,
        payload: {
          name: current.name.trim() || bed.name,
          covered: current.covered,
          // `null` rather than omitted, so a note can actually be taken off.
          note: current.note.trim() === '' ? null : current.note.trim(),
        },
      });
    });
  };

  const archive = (): void => {
    void archived.save(async () => {
      await log({
        entity: 'bed',
        op: 'delete',
        targetId: bedId,
        payload: { reason: 'Put away from the app' },
      });
    });
  };

  return (
    <Screen title={`Change ${bed.name}`} back>
      <Field label="What do you call it?">
        <TextField
          value={current.name}
          onChangeText={(name) => change({ name })}
          maxLength={80}
          testID="edit-bed-name"
        />
      </Field>

      {/* Not a label: the frost warning reads it, so a tunnel recorded as
          open ground raises alarms all spring for plants in no danger. */}
      <Field
        label="Is it under cover?"
        hint="A tunnel, a frame or a greenhouse. It changes what the frost warnings say about whatever is in it."
      >
        <Toggle
          label="Under cover"
          value={current.covered}
          onChange={(covered) => change({ covered })}
          testID="edit-bed-covered"
        />
      </Field>

      <Field label="Anything worth remembering">
        <TextField
          value={current.note}
          onChangeText={(note) => change({ note })}
          placeholder="Heavy soil, wet corner"
          maxLength={1000}
          multiline
          testID="edit-bed-note"
        />
      </Field>

      <Failure message={failure} />

      <Primary label="Save" disabled={saving} onPress={commit} testID="save-bed" />

      <Panel label="Take it out of use">
        {growing.length > 0 ? (
          <Body>
            There {growing.length === 1 ? 'is something' : 'are things'} still growing in{' '}
            {bed.name}. Finish or pull {growing.length === 1 ? 'it' : 'them'} first — a bed put
            away with a crop in it takes the crop off your screens with it.
          </Body>
        ) : (
          <>
            <Body>
              Every harvest taken out of {bed.name} stays. The bed stops appearing when you are
              deciding where to plant.
            </Body>
            <Failure message={archived.failure} />
            <Confirm
              label="Take it out of use"
              armedLabel="Tap again to take it out"
              onConfirm={archive}
              testID="archive-bed"
            />
          </>
        )}
      </Panel>
    </Screen>
  );
}
