import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import {
  formatMass,
  MASS_ENTRY_CHOICES,
  type MassEntryUnit,
  massEntryToUg,
} from '@homefarm/contracts';
import { listGroups, processedByGroup } from '@homefarm/core/read/groups';
import {
  Choice,
  Failure,
  Field,
  NumberField,
  Primary,
  Stepper,
  TextField,
  useSaver,
} from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { useUnits } from '../hooks/useUnits';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, TYPE } from '../theme/tokens';

/**
 * Taking a group for meat.
 *
 * ## There was no way to record this at all
 *
 * The app has counted down to it since the grow-out clock landed — *"Roasters
 * reach processing weight"* on Today, anchored at the start of the window
 * because the decision is "book the processor". And then there was nowhere to
 * say it had been done.
 *
 * What existed was `LossScreen` with `cause: 'cull'`. That screen is headed
 * **"Record a loss"**, opens *"the record nobody wants to make and every farm
 * has to"*, counts with a **negative** stepper, and its button reads "Record
 * 25 lost". Taking twenty-five broilers to the freezer at eight weeks is the
 * entire purpose of having raised them. Filing it beside a fox kill is not a
 * missing screen; it is the app misunderstanding what happened.
 *
 * It was also a dead end from the other direction. The due routed to `Weigh` —
 * one act, one screen, which is right for the weight it asks about — but
 * weighing does not discharge a processing row. Only a cull does
 * (`lastCullByGroup`). So a keeper tapped the row, weighed the birds, and the
 * row was still there tomorrow.
 *
 * ## The same record, not a second one
 *
 * This writes `mortality` with `cause: 'cull'`, exactly as the loss screen
 * would. A new entity was the obvious alternative and is the wrong shape: two
 * records that both mean "these animals are no longer alive" would have to be
 * reconciled by `lossesByGroup`, `lastCullByGroup`, the history builders, the
 * CSV export and the year's numbers — five places to disagree, which is the
 * hazard the loss screen's own panel already names about head counts.
 *
 * What is new is the **weight**, which the schema has wanted since it was
 * written and no screen ever collected.
 *
 * ## The head count is left alone, deliberately
 *
 * The same rule the loss screen states and for the same reason: that number is
 * what the keeper says is there, and two things editing it would disagree the
 * first time one was corrected by hand. Said here too, because a keeper who has
 * just processed the whole batch is the most likely person to expect otherwise.
 */

type Unit = MassEntryUnit;

const UNIT_LABELS: Record<Unit, string> = {
  lb: 'Pounds',
  oz: 'Ounces',
  kg: 'Kilos',
  g: 'Grams',
};

/** A typed box to micrograms, or null when there is no usable number in it. */
function toMass(raw: string, unit: Unit): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? massEntryToUg(value, unit) : null;
}

export function ProcessingScreen({ route }: ScreenProps<'Processing'>): React.ReactElement {
  const { groupId } = route.params;
  const log = useLog();
  const { colors } = useTheme();
  const units = useUnits();

  const groups = useLive(listGroups);
  const already = useLive(processedByGroup);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  /**
   * Zero, and the button refuses it — the loss screen's rule, kept.
   *
   * A number the app chose is the wrong default on any screen that records
   * animals being killed, however good the reason for killing them.
   */
  const [count, setCount] = useState(0);
  const [amount, setAmount] = useState('');
  /**
   * `null` is "has not chosen", which lets the picker follow the farm's setting
   * without overriding a deliberate tap. Same reasoning as `WeighScreen`: the
   * site read lands a frame after mount, so a stored default would show
   * imperial on a metric farm.
   */
  const [chosen, setChosen] = useState<Unit | null>(null);
  const [note, setNote] = useState('');

  const { saving, failure, save } = useSaver(useLeave());

  const choices = MASS_ENTRY_CHOICES[units];
  const unit: Unit = chosen ?? choices[0];
  const dressed = toMass(amount, unit);

  const commit = useCallback(() => {
    void save(async () => {
      await log({
        entity: 'mortality',
        op: 'create',
        payload: {
          occurredAt: Date.now(),
          flockId: groupId,
          count,
          cause: 'cull' as const,
          /**
           * Omitted rather than zero when the box is empty. A farm that
           * processes without weighing has recorded that it processed, which is
           * the fact that matters and the one that clears the row; a zero would
           * be a yield figure nobody measured, and it would sum.
           */
          ...(dressed === null ? {} : { dressedMassUg: dressed }),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
      });
    });
  }, [save, log, groupId, count, dressed, note]);

  if (groups === null) return <Loading title="Processing" />;
  if (group === null) return <Missing title="Processing" what="That group" />;

  const done = already?.get(groupId) ?? { count: 0, massUg: 0 };

  return (
    <Screen title="Take them for meat" back>
      <Text style={[styles.label, { color: colors.muted }]}>{group.name}</Text>

      <Field label="How many?">
        {/* Positive, unlike the loss screen's. This is the batch coming off,
            not a shortfall — and the two screens reading the same way would be
            the whole confusion this one exists to end. */}
        <Stepper value={count} onChange={setCount} steps={[1, 5]} suffix="head" testID="taken" />
      </Field>

      <Field
        label="Dressed weight, all of them (optional)"
        hint="The whole batch on the scale, not one bird. Per head is worked out from the count."
      >
        <NumberField
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          accessibilityLabel="Dressed weight"
          testID="processing-mass"
        />
        <Choice options={choices} value={unit} onChange={setChosen} labels={UNIT_LABELS} />
      </Field>

      <Field label="Anything else? (optional)">
        <TextField value={note} onChangeText={setNote} multiline maxLength={500} />
      </Field>

      <Panel label="What this does and does not do">
        <Body>
          This clears the processing row for {group.name} and records the yield. The head count
          stays as you set it — this app does not quietly subtract from it, because that number is
          what you say is there.
          {done.count > 0
            ? ` ${done.count} taken so far${
                done.massUg > 0 ? `, ${formatMass(done.massUg, units)} dressed` : ''
              }.`
            : ''}
        </Body>
      </Panel>

      <Failure message={failure} />

      <Primary
        label={count === 0 ? 'Take them for meat' : `Record ${count} taken`}
        disabled={saving || count === 0}
        onPress={commit}
        testID="save-processing"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
