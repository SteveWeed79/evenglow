import { useCallback, useState } from 'react';
import { listMachines, listServices } from '@steading/core/read/iron';
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
 * Correcting a machine, and retiring one.
 *
 * ## The serial is the point
 *
 * A machine's make, model, year and serial are the history that goes with it
 * when it is sold — P7, and the reason the hours and the services are kept at
 * all. A serial typed with a digit wrong is on the insurance and on the bill of
 * sale, and until this screen the record could not be corrected. `listMachines`
 * did not even carry those fields, because nothing could show them.
 *
 * ## The meter toggle is the dangerous control on this screen
 *
 * `serviceDue` refuses to build a row it cannot evaluate: an hours interval on
 * a machine with no meter produces **nothing**, rather than a row that sits on
 * Today for ever. That is right, and it means turning the meter off silently
 * stops every hour-based schedule on this machine from ever asking again.
 * `AddServiceScreen` already tells the story of a pump that ended up with a
 * 100-hour oil change nobody was ever reminded about. So the screen counts the
 * schedules that would go quiet and says so before the toggle is believed.
 *
 * ## Retiring it
 *
 * `useDues` walks machines and matches services to them, so an archived machine
 * takes its own due rows with it — a sold tractor stops asking for an oil
 * change, which is exactly right. Everything recorded stays (P13): the hours,
 * the services, the receipts.
 */
export function EditMachineScreen({ route }: ScreenProps<'EditMachine'>): React.ReactElement {
  const { machineId } = route.params;
  const nav = useNav();
  const log = useLog();

  const machines = useLive(listMachines);
  const services = useLive(listServices);
  const machine = machines?.find((candidate) => candidate.id === machineId) ?? null;

  const [edits, setEdits] = useState<{
    name: string;
    make: string;
    model: string;
    serial: string;
    year: number;
    hasHourMeter: boolean;
    note: string;
  } | null>(null);

  const { saving, failure, save } = useSaver(useLeave());
  const archived = useSaver(useCallback(() => nav.popTo('Tabs'), [nav]));

  if (machines === null) return <Loading title="Machine" />;
  if (machine === null) return <Missing title="Machine" what="That machine" />;

  const current = edits ?? {
    name: machine.name,
    make: machine.make ?? '',
    model: machine.model ?? '',
    serial: machine.serial ?? '',
    year: machine.year ?? 0,
    hasHourMeter: machine.hasHourMeter,
    note: machine.note ?? '',
  };

  const change = (next: Partial<typeof current>): void => setEdits({ ...current, ...next });

  /** Schedules that would stop asking if the meter came off. */
  const onHours = (services ?? []).filter(
    (service) => service.equipmentId === machineId && service.intervalHours !== undefined,
  );
  const goingQuiet = current.hasHourMeter ? [] : onHours;

  const commit = (): void => {
    void save(async () => {
      await log({
        entity: 'equipment',
        op: 'update',
        targetId: machineId,
        payload: {
          name: current.name.trim() || machine.name,
          hasHourMeter: current.hasHourMeter,
          // Named with `null` where empty, so a make typed in error can come
          // off rather than only being replaced.
          make: current.make.trim() === '' ? null : current.make.trim(),
          model: current.model.trim() === '' ? null : current.model.trim(),
          serial: current.serial.trim() === '' ? null : current.serial.trim(),
          note: current.note.trim() === '' ? null : current.note.trim(),
          // Zero is the "not said" the stepper can reach, and it is a clear
          // rather than the year nought.
          year: current.year > 0 ? current.year : null,
        },
      });
    });
  };

  const archive = (): void => {
    void archived.save(async () => {
      await log({
        entity: 'equipment',
        op: 'delete',
        targetId: machineId,
        payload: { reason: 'Retired from the app' },
      });
    });
  };

  return (
    <Screen title={`Change ${machine.name}`} back>
      <Field label="What do you call it?">
        <TextField
          value={current.name}
          onChangeText={(name) => change({ name })}
          maxLength={80}
          testID="edit-machine-name"
        />
      </Field>

      <Field label="Make">
        <TextField
          value={current.make}
          onChangeText={(make) => change({ make })}
          placeholder="Kubota"
          maxLength={80}
          testID="edit-machine-make"
        />
      </Field>

      <Field label="Model">
        <TextField
          value={current.model}
          onChangeText={(model) => change({ model })}
          placeholder="L2501"
          maxLength={80}
          testID="edit-machine-model"
        />
      </Field>

      {/* The one that goes on the bill of sale. */}
      <Field label="Serial number">
        <TextField
          value={current.serial}
          onChangeText={(serial) => change({ serial })}
          maxLength={80}
          caps
          testID="edit-machine-serial"
        />
      </Field>

      {/* Typed rather than stepped: a stepper from nothing to 2014 is two
          hundred taps, and a year is a number somebody knows exactly. */}
      <Field label="Year" hint="Leave it empty if you would rather not say.">
        <TextField
          value={current.year === 0 ? '' : String(current.year)}
          onChangeText={(text) => change({ year: Number(text.replace(/\D/g, '')) })}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="2014"
          testID="edit-machine-year"
        />
      </Field>

      <Field
        label="Does it have an hour meter?"
        hint="Hour-based services can only be worked out on a machine that counts hours."
      >
        <Toggle
          label="It has an hour meter"
          value={current.hasHourMeter}
          onChange={(hasHourMeter) => change({ hasHourMeter })}
          testID="edit-machine-meter"
        />
      </Field>

      {/* Said before the save, not discovered a season later when a service
          nobody was reminded about turns out to be overdue. */}
      {goingQuiet.length === 0 ? null : (
        <Panel label="This would silence a schedule">
          <Body>
            {goingQuiet.length === 1
              ? `“${goingQuiet[0]?.title}” is set on hours.`
              : `${goingQuiet.length} schedules are set on hours.`}{' '}
            Without a meter there is nothing to count, so{' '}
            {goingQuiet.length === 1 ? 'it stops' : 'they stop'} asking. Give{' '}
            {goingQuiet.length === 1 ? 'it' : 'them'} a day interval instead if you still want
            reminding.
          </Body>
        </Panel>
      )}

      <Field label="Anything worth remembering">
        <TextField
          value={current.note}
          onChangeText={(note) => change({ note })}
          placeholder="Starts badly below freezing"
          maxLength={500}
          multiline
          testID="edit-machine-note"
        />
      </Field>

      <Failure message={failure} />

      <Primary label="Save" disabled={saving} onPress={commit} testID="save-machine" />

      <Panel label="Retire it">
        <Body>
          The hours, the services and the receipts stay — they are the history that goes with it
          if it is sold. It stops appearing, and its services stop asking.
        </Body>
        <Failure message={archived.failure} />
        <Confirm
          label="Retire it"
          armedLabel="Tap again to retire it"
          onConfirm={archive}
          testID="archive-machine"
        />
      </Panel>
    </Screen>
  );
}
