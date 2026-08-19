import { useCallback, useState } from 'react';
import { newId } from '@homefarm/contracts';
import { Failure, Field, Primary, TextField, Toggle, useSaver } from '../components/Form';
import { Screen } from '../components/Screen';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';

/**
 * A bed — anywhere you plant.
 *
 * A raised bed, a row, a plot, a tunnel, a block of trees. Named the way it is
 * already said out loud, because a naming scheme somebody has to learn is a
 * naming scheme that gets ignored the first busy morning.
 */
export function AddBedScreen({ route }: ScreenProps<'AddBed'>): React.ReactElement {
  const { siteId } = route.params;
  const log = useLog();

  const [name, setName] = useState('');
  const [covered, setCovered] = useState(false);

  const { saving, failure, save } = useSaver(useLeave());

  const commit = useCallback(() => {
    void save(async () => {
      await log({
        entity: 'bed',
        op: 'create',
        targetId: newId(),
        payload: { siteId, name: name.trim(), covered },
      });
    });
  }, [save, log, siteId, name, covered]);

  return (
    <Screen title="Add a bed" back>
      <Field label="What do you call it?">
        <TextField
          value={name}
          onChangeText={setName}
          placeholder="Bed 3, the top row, the tunnel"
          maxLength={80}
          testID="bed-name"
        />
      </Field>

      {/* A tunnel beats the site's frost dates, which is why it is worth
          knowing rather than being a note nobody reads. */}
      <Toggle
        label="Under cover (tunnel, frame, cloche)"
        value={covered}
        onChange={setCovered}
      />

      <Failure message={failure} />

      <Primary
        label="Add bed"
        disabled={saving || name.trim() === ''}
        onPress={commit}
        testID="save-bed"
      />
    </Screen>
  );
}
