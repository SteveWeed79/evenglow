import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { HARVEST_UNITS, newId, ouncesToUg, poundsToUg } from '@steading/contracts';
import { listPlantings, listVarieties } from '@steading/core/read/growing';
import { Choice, Failure, Field, NumberField, Primary, TextField, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Tally } from '../components/Tally';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
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

export function HarvestScreen({ route }: ScreenProps<'Harvest'>): React.ReactElement {
  const { plantingId } = route.params;
  const nav = useNav();
  const log = useLog();
  const { colors } = useTheme();

  const plantings = useLive(listPlantings);
  const varieties = useLive(listVarieties);
  const planting = plantings?.find((p) => p.id === plantingId) ?? null;

  const [unit, setUnit] = useState<Unit>('mass');
  const [amount, setAmount] = useState('');
  const [pounds, setPounds] = useState(true);
  const [note, setNote] = useState('');

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const value = Number(amount);
  const massUg =
    Number.isFinite(value) && value > 0
      ? Math.round(pounds ? poundsToUg(value) : ouncesToUg(value))
      : null;

  const commit = useCallback(
    (count: number | null) => {
      // The contract refuses a mass harvest with no mass and a count harvest
      // with no count, so the guard is here rather than being discovered as a
      // rejected mutation.
      if (unit === 'mass' ? massUg === null : count === null) return;

      void save(async () => {
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
      });
    },
    [save, log, plantingId, unit, massUg, note, planting],
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
              suffix={pounds ? 'lb' : 'oz'}
              accessibilityLabel="Harvest weight"
              testID="harvest-mass"
            />
          </Field>

          <Field label="In">
            <Choice
              options={['lb', 'oz'] as const}
              value={pounds ? 'lb' : 'oz'}
              onChange={(next) => setPounds(next === 'lb')}
              labels={{ lb: 'Pounds', oz: 'Ounces' }}
            />
          </Field>

          <Field label="Anything worth noting? (optional)">
            <TextField value={note} onChangeText={setNote} maxLength={300} />
          </Field>

          <Failure message={failure} />

          <Primary
            label="Log it"
            disabled={saving || massUg === null}
            onPress={() => commit(null)}
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
            onCommit={(count) => commit(count)}
          />

          <Failure message={failure} />
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
