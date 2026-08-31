import { useCallback, useRef, useState } from 'react';
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
  Confirm,
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

  const leave = useLeave();

  /**
   * A meat flock has an ending and the app never acknowledged one.
   *
   * Asked from the farm as *"when does their group disappear?"*, and the answer
   * was: never, on its own. Taking the birds clears the processing row and does
   * nothing else — the head count stays as the keeper set it (deliberately, see
   * the panel below), the group stays on Stock, and the only exit is `Put this
   * group away` at the foot of the edit screen with nothing pointing at it. So
   * next spring's batch arrives beside a flock that went in the freezer in
   * August, and Stock becomes a graveyard.
   *
   * Offered rather than done. Archiving is the farm's call — a keeper who holds
   * a few back, or who is about to record a second batch, has a group that is
   * not finished — and the app has no business deciding a flock is over. What
   * it can do is stop making somebody remember.
   *
   * Measured against the head count because that is the only figure the app has
   * for how many were in this group, and it is the farm's own — the same
   * authority every other decision on this screen defers to.
   */
  const [finished, setFinished] = useState(false);

  /**
   * Read at commit rather than at render: `processedByGroup` re-reads once the
   * write lands, so a render-time comparison would race the publish that caused
   * it. The question is "did the batch I just recorded finish the group", and
   * that is answerable only from what was known when it was sent.
   */
  const finishes = useRef(false);

  const { saving, failure, save } = useSaver(
    useCallback(() => {
      if (finishes.current) {
        setFinished(true);
        return;
      }
      leave();
    }, [leave]),
  );

  const { saving: archiving, failure: archiveFailure, save: saveArchive } = useSaver(leave);

  const choices = MASS_ENTRY_CHOICES[units];
  const unit: Unit = chosen ?? choices[0];
  const dressed = toMass(amount, unit);

  const commit = useCallback(() => {
    finishes.current = group !== null && (already?.get(groupId)?.count ?? 0) + count >= group.count;

    void save(async () => {
      await log({
        entity: 'mortality',
        op: 'create',
        payload: {
          occurredAt: Date.now(),
          flockId: groupId,
          count,
          /**
           * `harvest`, which is what this act is. It was `cull` because that
           * was the only cause the schema had — and a cull is a different
           * thing: an animal that did not work out, which the farm got nothing
           * for. Writing them alike meant `lossesByGroup` reported a finished
           * batch of broilers as birds *lost*.
           */
          cause: 'harvest' as const,
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
  }, [save, log, groupId, count, dressed, note, group, already]);

  const putAway = useCallback(() => {
    void saveArchive(async () => {
      await log({
        entity: 'flock',
        op: 'delete',
        targetId: groupId,
        payload: { reason: 'Taken for meat' },
      });
    });
  }, [saveArchive, log, groupId]);

  if (groups === null) return <Loading title="Processing" />;
  if (group === null) return <Missing title="Processing" what="That group" />;

  const done = already?.get(groupId) ?? { count: 0, massUg: 0 };

  /**
   * The ending, offered once the whole group is accounted for.
   *
   * Replaces the form rather than sitting under it. The batch has been written
   * — that is what got us here — and leaving the stepper on screen beside it
   * would invite recording it twice, on an append-only entity with no undo.
   *
   * Two ways out and neither is buried: put it away, or leave it be. "Leave it
   * be" is a real answer rather than a cancel — a keeper holding a few birds
   * back has a group that is still running, and the app must not imply
   * otherwise by making the other button the only one.
   */
  if (finished) {
    return (
      <Screen title="Take them for meat" back>
        <Text style={[styles.label, { color: colors.muted }]}>{group.name}</Text>

        <Panel label="That is the whole group">
          <Body>
            {done.count} taken from {group.name}
            {done.massUg > 0 ? `, ${formatMass(done.massUg, units)} dressed` : ''}. That is everyone
            you said was there.
          </Body>
          <Body>
            Putting them away keeps every record — the feed, the weights, what they yielded — and
            stops {group.name} appearing in your lists. Nothing is deleted, and nothing here has to
            be done now.
          </Body>
          <Failure message={archiveFailure} />
          <Confirm
            label={`Put ${group.name} away`}
            armedLabel="Tap again to put them away"
            onConfirm={putAway}
            testID="put-group-away"
          />
        </Panel>

        <Primary label="Leave it be" disabled={archiving} onPress={leave} testID="keep-group" />
      </Screen>
    );
  }

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
