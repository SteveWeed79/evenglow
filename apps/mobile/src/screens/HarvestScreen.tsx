import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import {
  HARVEST_UNITS,
  MASS_ENTRY_CHOICES,
  type MassEntryUnit,
  massEntryToUg,
  newId,
} from '@homefarm/contracts';
import { listPlantings, listVarieties } from '@homefarm/core/read/growing';
import { Choice, Failure, Field, NumberField, Primary, TextField, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { useUnits } from '../hooks/useUnits';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Tally } from '../components/Tally';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { reportTrouble } from '../hooks/useTrouble';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, TYPE } from '../theme/tokens';

/**
 * What came off, this morning.
 *
 * Append-only, exactly like an egg log, and for exactly the same reason: two
 * people picking the same bed on the same morning produce two rows and both
 * are true. An observation cannot conflict, which is the whole point of the
 * classification.
 *
 * **Mass and count are separate fields rather than one number with a tag.**
 * Summing them is the most common thing anything does with these rows, and a
 * tagged union makes every sum a branch. So the unit chooses which control
 * appears: a weight is typed, and a count of courgettes is tallied through a
 * glove like everything else that is counted.
 */

type Unit = (typeof HARVEST_UNITS)[number];

const UNIT_LABELS: Record<Unit, string> = {
  mass: 'By weight',
  count: 'By the number',
  bunch: 'By the bunch',
};

/** Spelled out on the chip, abbreviated on the box — the same split `WeighScreen` uses. */
const MASS_UNIT_LABELS: Record<MassEntryUnit, string> = {
  lb: 'Pounds',
  oz: 'Ounces',
  kg: 'Kilos',
  g: 'Grams',
};

export function HarvestScreen({ route }: ScreenProps<'Harvest'>): React.ReactElement {
  const { plantingId } = route.params;
  const log = useLog();
  const { colors } = useTheme();

  const plantings = useLive(listPlantings);
  const varieties = useLive(listVarieties);
  const planting = plantings?.find((p) => p.id === plantingId) ?? null;

  const units = useUnits();
  /**
   * The pair this farm types in, heavier first.
   *
   * This screen used to offer pounds and ounces to everybody, converting with
   * `poundsToUg` regardless of the setting — so a metric farm weighing a crate
   * in kilos either typed a number the app read as pounds, or converted in its
   * head at the one moment where the rounding becomes a stored integer nothing
   * downstream can tell from a real weighing.
   */
  const [heavy, light] = MASS_ENTRY_CHOICES[units];

  const [unit, setUnit] = useState<Unit>('mass');
  const [amount, setAmount] = useState('');
  const [massUnit, setMassUnit] = useState<MassEntryUnit>(heavy);
  const [note, setNote] = useState('');

  /**
   * Follow the setting when it changes under the screen.
   *
   * `useUnits` reads the site record live, so switching to metric in Settings
   * with this screen behind it would otherwise leave the box labelled `lb`
   * while everything else on the device had moved.
   */
  useEffect(() => {
    setMassUnit((current) => (current === heavy || current === light ? current : heavy));
  }, [heavy, light]);

  const leave = useLeave();
  const { saving, failure, save } = useSaver(leave);

  const value = Number(amount);
  const massUg = Number.isFinite(value) && value > 0 ? massEntryToUg(value, massUnit) : null;

  /**
   * The writes, and nothing about who hears if they fail.
   *
   * **This screen has two entries and they need opposite handling**, which is
   * why the reporting moved out of here. The typed form below is an ordinary
   * form: `useSaver` catches, disables the button while it runs and prints the
   * failure on the screen. The tally is not — `Tally` holds a count it has
   * already cleared optimistically, and only a **rejection** puts it back.
   *
   * Wrapping the tally in the saver meant a failed pick was cleared, announced
   * with a success sentence and a success haptic, and shown an error panel
   * beside it. So the throw is left in, and the two callers differ in who
   * catches it.
   */
  const commit = useCallback(
    async (count: number | null) => {
      // The contract refuses a mass harvest with no mass and a count harvest
      // with no count, so the guard is here rather than being discovered as a
      // rejected mutation.
      if (unit === 'mass' ? massUg === null : count === null) return;

      await log({
        entity: 'harvest',
        op: 'create',
        targetId: newId(),
        payload: {
          plantingId,
          occurredAt: Date.now(),
          unit,
          ...(unit === 'mass' ? { massUg } : { count }),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
      });

      /**
       * The first pick moves the planting to `harvesting`.
       *
       * That status is what stops `growingDues` producing "should be ready"
       * every day for the rest of the season — harvest is the one stage with
       * no completion field of its own, because picking goes on for weeks.
       */
      if (planting !== null && planting.status !== 'harvesting') {
        await log({
          entity: 'planting',
          op: 'update',
          targetId: plantingId,
          payload: { status: 'harvesting' },
        });
      }
    },
    [log, plantingId, unit, massUg, note, planting],
  );

  /**
   * The tally's caller: `Tally` gets the rejection so it can put the count
   * back, and the banner still gets the trace. It leaves on success the way
   * the saver does for the form.
   */
  const tallied = useCallback(
    async (count: number) => {
      try {
        await commit(count);
      } catch (error) {
        reportTrouble('saving that', error);
        throw error;
      }
      leave();
    },
    [commit, leave],
  );

  if (plantings === null) return <Loading title="Harvest" />;
  if (planting === null) return <Missing title="Harvest" what="That planting" />;

  const variety = varieties?.find((v) => v.id === planting.varietyId);

  return (
    <Screen title="Log a harvest" back>
      <Text style={[styles.label, { color: colors.muted }]}>
        {variety?.name ?? 'This planting'}
      </Text>

      <Field label="How are you measuring it?">
        <Choice options={HARVEST_UNITS} value={unit} onChange={setUnit} labels={UNIT_LABELS} />
      </Field>

      {unit === 'mass' ? (
        <>
          <Field label="How much?">
            <NumberField
              value={amount}
              onChangeText={setAmount}
              placeholder="4.5"
              suffix={massUnit}
              accessibilityLabel="Harvest weight"
              testID="harvest-mass"
            />
          </Field>

          <Field label="In">
            <Choice
              options={[heavy, light] as const}
              value={massUnit}
              onChange={setMassUnit}
              labels={MASS_UNIT_LABELS}
            />
          </Field>

          <Field label="Anything worth noting? (optional)">
            <TextField value={note} onChangeText={setNote} maxLength={300} />
          </Field>

          <Failure message={failure} />

          <Primary
            label="Log it"
            disabled={saving || massUg === null}
            onPress={() => void save(() => commit(null))}
            testID="save-harvest"
          />
        </>
      ) : (
        <>
          <Panel label="Count them">
            <Body>
              Same control as the egg tally, because it is the same job — standing in a bed with
              a full basket and one free hand.
            </Body>
          </Panel>

          <Tally
            label={`${variety?.name ?? 'Harvest'} from this bed`}
            unit={unit === 'bunch' ? 'bunches' : 'picked'}
            steps={[1, 5, 10]}
            onCommit={tallied}
          />
        </>
      )}
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
