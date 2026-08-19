import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import {
  enteredToStored,
  entryUnit,
  formatMass,
  formatVolume,
  gramsToUg,
  longestWithdrawal,
  mlToUl,
  PRODUCE_KINDS,
  type UnitSystem,
} from '@homefarm/contracts';
import { listGroups, produceToday } from '@homefarm/core/read/groups';
import { withdrawalsBySubject } from '@homefarm/core/read/withdrawals';
import { Choice, Failure, Field, TextField, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Tally } from '../components/Tally';
import { WithdrawalBanner } from '../components/WithdrawalBanner';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { useUnits } from '../hooks/useUnits';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, TYPE } from '../theme/tokens';

/**
 * Milk, fibre and honey — everything off an animal that is not an egg.
 *
 * Without this, ruminant support is head count and mortality, which is not
 * support. A dairy goat produces a number twice a day and it is the number the
 * whole enterprise turns on; a fleece is annual with a weight; honey is by the
 * super. One entity covers all three because what differs between them is the
 * unit and the cadence, not the shape.
 *
 * **The withdrawal interlock applies here too.** Milk withdrawal is the one
 * most likely to catch someone out — a treated doe's milk is off for days
 * after the eggs would have cleared — so the same banner and the same
 * deliberate confirm tap the egg tally uses are wired in, reading the same
 * `activeWithdrawals` arithmetic rather than a second copy of it.
 *
 * Out of scope, deliberately: creamery workflows and milk testing. This
 * records a volume, not a supply chain.
 */

type Produce = (typeof PRODUCE_KINDS)[number];

const LABELS: Record<Produce, string> = {
  milk: 'Milk',
  fibre: 'Fibre',
  honey: 'Honey',
  other: 'Something else',
};

/** Millilitres for liquids, grams for solids. Integers avoid a season's drift. */
const UNITS: Record<Produce, 'ml' | 'g'> = { milk: 'ml', fibre: 'g', honey: 'g', other: 'g' };

/**
 * Steps that match how the thing is actually measured, in each system.
 *
 * A milking pail moves in hundreds of millilitres and a fleece in whole
 * kilos — offering +1 for either would be a control nobody could reach the
 * real number with. The imperial column is the same argument in the units a
 * US farm owns vessels in: a cup, a pint and a quart of milk; a quarter
 * pound, a pound and two pounds of fleece.
 */
const STEPS: Record<Produce, Record<UnitSystem, readonly number[]>> = {
  milk: { metric: [50, 100, 500], imperial: [8, 16, 32] },
  fibre: { metric: [100, 500, 1000], imperial: [4, 16, 32] },
  honey: { metric: [100, 500, 1000], imperial: [4, 16, 32] },
  other: { metric: [1, 10, 100], imperial: [1, 4, 16] },
};

/** What is already recorded today, read back in the farm's own units. */
function alreadyToday(amount: number, unit: string, system: UnitSystem): string {
  return unit === 'ml' ? formatVolume(mlToUl(amount), system) : formatMass(gramsToUg(amount), system);
}

export function ProduceScreen({ route }: ScreenProps<'Produce'>): React.ReactElement {
  const { groupId } = route.params;
  const log = useLog();
  const units = useUnits();
  const { colors } = useTheme();

  const groups = useLive(listGroups);
  const today = useLive(produceToday);
  const withdrawals = useLive(
    // Milk, not eggs: this screen's interlock is about what it records.
    useCallback(() => withdrawalsBySubject('milk', [groupId]), [groupId]),
  );

  const group = groups?.find((g) => g.id === groupId) ?? null;

  const [kind, setKind] = useState<Produce>('milk');
  const [label, setLabel] = useState('');

  const { failure, save } = useSaver(useLeave());

  const commit = useCallback(
    async (amount: number, acknowledged: boolean) => {
      await save(async () => {
        await log({
          entity: 'productionLog',
          op: 'create',
          payload: {
            occurredAt: Date.now(),
            flockId: groupId,
            kind,
            // The stepper counted in the farm's unit; the schema takes mL or g.
            amount: enteredToStored(amount, UNITS[kind], units),
            unit: UNITS[kind],
            ...(kind === 'other' && label.trim() !== '' ? { label: label.trim() } : {}),
            // Recorded, not merely displayed: an acknowledged withdrawal is
            // the audit trail for a decision somebody made deliberately.
            ...(acknowledged ? { withdrawalAcknowledged: true } : {}),
          },
        });
      });
    },
    [save, log, groupId, kind, label, units],
  );

  if (groups === null) return <Loading title="Produce" />;
  if (group === null) return <Missing title="Produce" what="That group" />;

  const withdrawal = longestWithdrawal(withdrawals?.get(groupId) ?? []);
  const already = today?.get(`${groupId}:${kind}`);

  return (
    <Screen title="What they gave" back>
      <Text style={[styles.label, { color: colors.muted }]}>{group.name}</Text>

      {withdrawal ? <WithdrawalBanner withdrawal={withdrawal} /> : null}

      <Field label="What did you take?">
        <Choice options={PRODUCE_KINDS} value={kind} onChange={setKind} labels={LABELS} />
      </Field>

      {kind === 'other' ? (
        <Field label="What is it?">
          <TextField value={label} onChangeText={setLabel} placeholder="Tallow, feathers, down" maxLength={80} />
        </Field>
      ) : null}

      {already ? (
        <Panel label="Already today">
          <Body>
            {alreadyToday(already.amount, already.unit, units)} of {LABELS[kind].toLowerCase()} so
            far. This adds to it — a morning and an evening milking are two records, and both are
            true.
          </Body>
        </Panel>
      ) : null}

      <Tally
        label={`${LABELS[kind]} from ${group.name}`}
        unit={entryUnit(UNITS[kind], units)}
        steps={STEPS[kind][units]}
        // A herd's morning is five gallons — twenty taps of +32, and worse in
        // millilitres. One goat still uses the steps; see `typed`.
        typed
        requireConfirm={withdrawal !== null}
        onCommit={(value, acknowledged) => void commit(value, acknowledged)}
      />

      <Failure message={failure} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
