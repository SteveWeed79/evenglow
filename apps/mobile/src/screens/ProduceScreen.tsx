import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { longestWithdrawal, PRODUCE_KINDS } from '@steading/contracts';
import { listGroups, produceToday } from '@steading/core/read/groups';
import { withdrawalsBySubject } from '@steading/core/read/withdrawals';
import { Choice, Failure, Field, TextField, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Tally } from '../components/Tally';
import { WithdrawalBanner } from '../components/WithdrawalBanner';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
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
 * Steps that match how the thing is actually measured.
 *
 * A milking pail moves in hundreds of millilitres and a fleece in whole
 * kilos — offering +1 for either would be a control nobody could reach the
 * real number with.
 */
const STEPS: Record<Produce, readonly number[]> = {
  milk: [50, 100, 500],
  fibre: [100, 500, 1000],
  honey: [100, 500, 1000],
  other: [1, 10, 100],
};

export function ProduceScreen({ route }: ScreenProps<'Produce'>): React.ReactElement {
  const { groupId } = route.params;
  const nav = useNav();
  const log = useLog();
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

  const { failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

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
            amount,
            unit: UNITS[kind],
            ...(kind === 'other' && label.trim() !== '' ? { label: label.trim() } : {}),
            // Recorded, not merely displayed: an acknowledged withdrawal is
            // the audit trail for a decision somebody made deliberately.
            ...(acknowledged ? { withdrawalAcknowledged: true } : {}),
          },
        });
      });
    },
    [save, log, groupId, kind, label],
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
            {already.amount} {already.unit} of {LABELS[kind].toLowerCase()} so far. This adds to
            it — a morning and an evening milking are two records, and both are true.
          </Body>
        </Panel>
      ) : null}

      <Tally
        label={`${LABELS[kind]} from ${group.name}`}
        unit={UNITS[kind]}
        steps={STEPS[kind]}
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
