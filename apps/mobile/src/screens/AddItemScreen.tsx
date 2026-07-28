import { useCallback, useState } from 'react';
import { INVENTORY_KINDS, INVENTORY_UNITS, newId } from '@steading/contracts';
import { listMachines } from '@steading/core/read/iron';
import {
  Choice,
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
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';

/**
 * Something onto the shelf.
 *
 * `reorderBelow` is optional and that is deliberate: an item tracked without
 * one is a count somebody wanted to keep, and nagging about it would teach
 * them to stop keeping it. The threshold is what turns tracking into warning,
 * and it should be asked for rather than assumed.
 */

const KIND_LABELS = {
  feed: 'Feed',
  bedding: 'Bedding',
  medicine: 'Medicine',
  part: 'A part',
  other: 'Something else',
} as const;

const UNIT_LABELS = {
  kg: 'Kilos',
  lb: 'Pounds',
  bag: 'Bags',
  bale: 'Bales',
  litre: 'Litres',
  gallon: 'Gallons',
  dose: 'Doses',
  each: 'Each',
} as const;

export function AddItemScreen({ route }: ScreenProps<'AddItem'>): React.ReactElement {
  const nav = useNav();
  const log = useLog();
  const machines = useLive(listMachines);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof INVENTORY_KINDS)[number]>(
    route.params.equipmentId === undefined ? 'feed' : 'part',
  );
  const [unit, setUnit] = useState<(typeof INVENTORY_UNITS)[number]>('bag');
  const [quantity, setQuantity] = useState(1);
  const [warns, setWarns] = useState(true);
  const [reorderBelow, setReorderBelow] = useState(1);
  const [equipmentId, setEquipmentId] = useState<string | null>(route.params.equipmentId ?? null);

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const commit = useCallback(() => {
    void save(async () => {
      await log({
        entity: 'inventory',
        op: 'create',
        targetId: newId(),
        payload: {
          name: name.trim(),
          kind,
          unit,
          quantity,
          ...(warns ? { reorderBelow } : {}),
          // Only meaningful on a part: linking a bale of straw to the tractor
          // would put it in the "can this service be done" question wrongly.
          ...(kind === 'part' && equipmentId !== null ? { equipmentId } : {}),
        },
      });
    });
  }, [save, log, name, kind, unit, quantity, warns, reorderBelow, equipmentId]);

  const iron = machines ?? [];

  return (
    <Screen title="Add to the shelf" back>
      <Field label="What is it?">
        <TextField
          value={name}
          onChangeText={setName}
          placeholder="Layers pellets, oil filter, straw"
          maxLength={120}
          testID="item-name"
        />
      </Field>

      <Field label="What kind?">
        <Choice options={INVENTORY_KINDS} value={kind} onChange={setKind} labels={KIND_LABELS} />
      </Field>

      <Field label="Counted in">
        <Choice options={INVENTORY_UNITS} value={unit} onChange={setUnit} labels={UNIT_LABELS} />
      </Field>

      <Field label="How many now?">
        <Stepper value={quantity} onChange={setQuantity} steps={[1, 5]} suffix={unit} />
      </Field>

      <Toggle label="Tell me when it runs low" value={warns} onChange={setWarns} />

      {warns ? (
        <Field label="Low is">
          <Stepper value={reorderBelow} onChange={setReorderBelow} steps={[1, 5]} suffix={unit} />
        </Field>
      ) : null}

      {kind === 'part' && iron.length > 0 ? (
        <Field
          label="For which machine? (optional)"
          hint="A part tied to a machine can warn before that machine's service is due."
        >
          <Choice
            options={['none', ...iron.map((m) => m.id)] as const}
            value={equipmentId ?? 'none'}
            onChange={(next) => setEquipmentId(next === 'none' ? null : next)}
            labels={{
              none: 'Not tied to one',
              ...Object.fromEntries(iron.map((m) => [m.id, m.name])),
            }}
          />
        </Field>
      ) : null}

      {kind === 'part' && iron.length === 0 ? (
        <Panel label="No machines yet">
          <Body>
            Add a machine under Iron and you can tie this part to it, so a service due in a
            fortnight can say whether the part is actually in the barn.
          </Body>
        </Panel>
      ) : null}

      <Failure message={failure} />

      <Primary
        label="Add it"
        disabled={saving || name.trim() === ''}
        onPress={commit}
        testID="save-item"
      />
    </Screen>
  );
}
