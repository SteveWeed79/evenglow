import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  formatMoney,
  INVENTORY_KINDS,
  INVENTORY_UNITS,
  minorPer,
  newId,
  SPECIES_TRAITS,
  type Species,
} from '@homefarm/contracts';
import { listGroups } from '@homefarm/core/read/groups';
import { listMachines } from '@homefarm/core/read/iron';
import {
  Chip,
  Choice,
  Failure,
  Field,
  NumberField,
  Primary,
  Stepper,
  TextField,
  Toggle,
  useSaver,
} from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { useCurrency } from '../hooks/useUnits';
import type { ScreenProps } from '../navigation/Root';
import { SPACE } from '../theme/tokens';

/**
 * Something onto the shelf.
 *
 * `reorderBelow` is optional and that is deliberate: an item tracked without
 * one is a count somebody wanted to keep, and nagging about it would teach
 * them to stop keeping it. The threshold is what turns tracking into warning,
 * and it should be asked for rather than assumed.
 *
 * ## What it cost, asked the way it is known
 *
 * A farm knows what it paid for the sack. It does not know, and should not
 * have to work out in a feed store, what one pound of that sack costs. So the
 * field asks for the total and the app divides — the stored rate is per unit,
 * because `quantity` draws down as the sack empties and a total paid would
 * have to be re-divided every time to stay meaningful.
 *
 * Optional, like the threshold and for the same reason. A farm that never
 * answers keeps a shelf that works; it simply gets no cost-per-egg, and the
 * screen that would show one says why rather than showing a figure built from
 * half the feedings.
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
  const log = useLog();
  const machines = useLive(listMachines);
  const groups = useLive(listGroups);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof INVENTORY_KINDS)[number]>(
    route.params.equipmentId === undefined ? 'feed' : 'part',
  );
  const [unit, setUnit] = useState<(typeof INVENTORY_UNITS)[number]>('bag');
  /**
   * Nothing, until somebody says otherwise.
   *
   * These started at 1, so every entry began by pressing minus — a bag of feed
   * is fifty pounds or twenty kilos, never one of anything. A stepper holding a
   * number nobody typed is a pre-filled answer, and saving without touching it
   * records a quantity the app chose.
   */
  const [quantity, setQuantity] = useState(0);
  const [warns, setWarns] = useState(true);
  const [reorderBelow, setReorderBelow] = useState(0);
  const [equipmentId, setEquipmentId] = useState<string | null>(route.params.equipmentId ?? null);
  const [species, setSpecies] = useState<Species[]>([]);
  /** What the whole lot cost, as typed. Divided by `quantity` before storing. */
  const [paid, setPaid] = useState('');

  const currency = useCurrency();

  /**
   * The per-unit rate, or null when there is nothing honest to store.
   *
   * A price with no quantity to divide by is not a rate, and rounding to the
   * nearest minor unit is deliberate — a tenth of a cent per pound is below
   * what anybody typed and pretending to it would be false precision.
   */
  const costCents = useMemo(() => {
    const total = Number(paid);
    if (!Number.isFinite(total) || total <= 0 || quantity <= 0) return null;
    return Math.round((total * minorPer(currency)) / quantity);
  }, [paid, quantity, currency]);

  /**
   * Only the species this farm actually keeps.
   *
   * Nineteen chips, seventeen of them for animals nobody here owns, is a list
   * that gets skipped — and a skipped list means the field stays empty and the
   * feed screen learns nothing.
   */
  const kept = useMemo(
    () => [...new Set((groups ?? []).map((group) => group.species))],
    [groups],
  );

  const { saving, failure, save } = useSaver(useLeave());

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
          // Only on feed, and only when something was actually ticked: the
          // schema refuses an empty array, because "nobody said" and "for
          // nothing" must not be the same value.
          ...(kind === 'feed' && species.length > 0 ? { species } : {}),
          // Only meaningful on a part: linking a bale of straw to the tractor
          // would put it in the "can this service be done" question wrongly.
          ...(kind === 'part' && equipmentId !== null ? { equipmentId } : {}),
          ...(costCents === null ? {} : { costCents }),
        },
      });
    });
  }, [save, log, name, kind, unit, quantity, warns, reorderBelow, equipmentId, species, costCents]);

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
        <Stepper
          value={quantity}
          onChange={setQuantity}
          steps={[1, 5]}
          suffix={unit}
          testID="item-quantity"
        />
      </Field>

      <Field
        label="What did the lot cost? (optional)"
        hint={
          costCents === null
            ? 'What you paid for all of it. Feed priced here is what makes cost per egg possible.'
            : `${formatMoney(costCents, currency)} per ${unit}.`
        }
      >
        <NumberField
          value={paid}
          onChangeText={setPaid}
          placeholder="22.50"
          accessibilityLabel="What the lot cost"
          testID="item-paid"
        />
      </Field>

      <Toggle label="Tell me when it runs low" value={warns} onChange={setWarns} />

      {warns ? (
        <Field label="Low is">
          <Stepper
            value={reorderBelow}
            onChange={setReorderBelow}
            steps={[1, 5]}
            suffix={unit}
            testID="item-reorder"
          />
        </Field>
      ) : null}

      {kind === 'feed' && kept.length > 0 ? (
        <Field
          label="Who is it for? (optional)"
          hint="Chick starter is not goat feed. Saying so puts it at the front when you feed them — everything on the shelf is still offered."
        >
          <View style={styles.chips}>
            {kept.map((option) => (
              <Chip
                key={option}
                label={SPECIES_TRAITS[option].label}
                selected={species.includes(option)}
                testID={`item-species-${option}`}
                onPress={() =>
                  setSpecies((current) =>
                    current.includes(option)
                      ? current.filter((s) => s !== option)
                      : [...current, option],
                  )
                }
              />
            ))}
          </View>
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

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md },
});
