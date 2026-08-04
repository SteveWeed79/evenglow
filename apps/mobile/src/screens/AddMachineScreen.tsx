import { useCallback, useState } from 'react';
import { newId } from '@steading/contracts';
import {
  Failure,
  Field,
  NumberField,
  Primary,
  TextField,
  Toggle,
  useSaver,
} from '../components/Form';
import { Screen } from '../components/Screen';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';

/**
 * A machine.
 *
 * The hour-meter question is the only one that changes what the app can do
 * with it afterwards: pumps and augers have no meter and their services run
 * off dates, and assuming one would put a row on Today that nothing can ever
 * clear.
 *
 * ## Asking what the meter reads, here, on the way in
 *
 * **Almost no tractor arrives at zero.** A used machine comes with hours on it
 * already, and this screen used to record only that a meter exists — so the
 * first service projection had no baseline at all until somebody separately
 * found Log hours and typed one in. A farm that added a 2,400-hour tractor and
 * expected the app to know when its next service was due got silence, and
 * nothing on screen explained why.
 *
 * It is optional, because a genuinely new machine reads zero and somebody
 * adding one from the kitchen table cannot see the meter from there. Blank
 * writes no reading, which is exactly what happened before.
 *
 * The reading is a second mutation rather than a field on the machine, and
 * that is not a workaround: `hourReading` is append-only and the whole point
 * of it is that a meter has a history. Storing "current hours" on the
 * equipment record would be a second source of truth that drifts from the
 * readings, and the service projection reads the readings.
 */
export function AddMachineScreen(): React.ReactElement {
  const nav = useNav();
  const log = useLog();

  const [name, setName] = useState('');
  const [make, setMake] = useState('');
  const [hasHourMeter, setHasHourMeter] = useState(true);
  const [hours, setHours] = useState('');

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const commit = useCallback(() => {
    void save(async () => {
      // Minted here so the reading below can name the machine it belongs to.
      // Both writes are the client's own ULIDs (invariant 3), so an offline
      // pair references itself correctly and flushes in order.
      const machineId = newId();

      await log({
        entity: 'equipment',
        op: 'create',
        targetId: machineId,
        payload: {
          name: name.trim(),
          hasHourMeter,
          ...(make.trim() === '' ? {} : { make: make.trim() }),
        },
      });

      // Zero is a real reading on a new machine, so this tests for a typed
      // value rather than for a truthy one.
      const reading = Number(hours);
      if (hasHourMeter && hours.trim() !== '' && Number.isFinite(reading)) {
        await log({
          entity: 'hourReading',
          op: 'create',
          targetId: newId(),
          payload: { occurredAt: Date.now(), equipmentId: machineId, hours: reading },
        });
      }
    });
  }, [save, log, name, hasHourMeter, make, hours]);

  return (
    <Screen title="Add a machine" back>
      <Field label="What is it?">
        <TextField
          value={name}
          onChangeText={setName}
          placeholder="The tractor, the mower, the pump"
          maxLength={80}
          testID="machine-name"
        />
      </Field>

      <Field label="Make and model (optional)">
        <TextField value={make} onChangeText={setMake} placeholder="Kubota L2501" maxLength={80} />
      </Field>

      <Toggle label="It has an hour meter" value={hasHourMeter} onChange={setHasHourMeter} />

      {hasHourMeter ? (
        <Field
          label="What does the meter read now?"
          hint="Leave it blank if you cannot see it from here — you can log a reading any time. Services count from this, so a used machine wants its real figure rather than zero."
        >
          <NumberField
            value={hours}
            onChangeText={setHours}
            placeholder="2400"
            suffix="hours"
            accessibilityLabel="The hour meter reading"
            testID="machine-hours"
          />
        </Field>
      ) : null}

      <Failure message={failure} />

      <Primary
        label="Add machine"
        disabled={saving || name.trim() === ''}
        onPress={commit}
        testID="save-machine"
      />
    </Screen>
  );
}
