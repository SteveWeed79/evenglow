import { useCallback, useState } from 'react';
import { newId } from '@steading/contracts';
import { Failure, Field, Primary, TextField, Toggle, useSaver } from '../components/Form';
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
 */
export function AddMachineScreen(): React.ReactElement {
  const nav = useNav();
  const log = useLog();

  const [name, setName] = useState('');
  const [make, setMake] = useState('');
  const [hasHourMeter, setHasHourMeter] = useState(true);

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const commit = useCallback(() => {
    void save(async () => {
      await log({
        entity: 'equipment',
        op: 'create',
        targetId: newId(),
        payload: {
          name: name.trim(),
          hasHourMeter,
          ...(make.trim() === '' ? {} : { make: make.trim() }),
        },
      });
    });
  }, [save, log, name, hasHourMeter, make]);

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
