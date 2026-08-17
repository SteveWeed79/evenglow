import { useCallback, useState } from 'react';
import { STOCK_REASONS, newId, type StockReason } from '@steading/contracts';
import { listInventory } from '@steading/core/read/iron';
import { Choice, Failure, Field, Primary, Stepper, TextField, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Timeline } from '../components/Timeline';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';

/**
 * What happened to something on the shelf.
 *
 * ## Why this is not just the stepper
 *
 * The card already has a stepper and it stays. Reported from a farm: *"users
 * should be able to add direct quantities to the items on the shelf as needed.
 * Currently if an item is on the shelf it's there until used. What if some is
 * lost? Mice etc?"*
 *
 * The number could always be changed. What it could not do was **say anything**
 * — a sack going from ten to six left no trace of whether it was fed out, sold,
 * spilled or eaten by something. And because logging feed is the one thing that
 * already drew the shelf down, every other reason silently looked like
 * consumption.
 *
 * That is not tidiness. `feedCostPerEgg` divides what the feed cost by what came
 * off the birds, and a farm that loses a quarter of a sack to vermin has not
 * spent that on eggs. Counted as feed it quietly inflates the cost of every egg
 * that year.
 *
 * ## Two paths on purpose, and the same split the loss screen already makes
 *
 * The stepper is a **correction**: a miscount, a rounding, a number that was
 * never right. This screen is an **event**: something happened on a day, for a
 * reason, and it is worth keeping.
 *
 * `LossScreen` draws the same line and says so out loud — *the head count stays
 * as you set it, this app does not quietly subtract*. The difference here is
 * that a shelf quantity is the thing being asked about, so this screen does move
 * it, and says so before the button is pressed.
 */

const REASON_LABELS: Record<StockReason, string> = {
  bought: 'Bought more',
  used: 'Used it',
  lost: 'Lost',
  spoiled: 'Spoiled',
  miscounted: 'Miscounted',
  other: 'Something else',
};

/**
 * Which way each reason moves the shelf.
 *
 * Asked here rather than of the person, because nobody buying feed also wants
 * to be asked whether buying means more or less. Only `miscounted` and `other`
 * are genuinely ambiguous, and those two get the choice.
 */
const ADDS: Record<StockReason, boolean | null> = {
  bought: true,
  used: false,
  lost: false,
  spoiled: false,
  miscounted: null,
  other: null,
};

export function AdjustStockScreen({ route }: ScreenProps<'AdjustStock'>): React.ReactElement {
  const { itemId } = route.params;
  const log = useLog();

  const items = useLive(listInventory);
  const item = items?.find((candidate) => candidate.id === itemId) ?? null;

  const [reason, setReason] = useState<StockReason>('lost');
  const [amount, setAmount] = useState(0);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');

  const { saving, failure, save } = useSaver(useLeave());

  const direction = ADDS[reason];
  const up = direction ?? adding;

  const record = useCallback(() => {
    if (item === null || amount <= 0) return;

    void save(async () => {
      const delta = up ? amount : -amount;

      /**
       * The event first, then the running total.
       *
       * Two mutations rather than one, the same shape `FeedScreen` uses to log
       * a feed and draw the sack down, and `AddVarietyScreen` to add a variety
       * and plant it. Each is durable on its own; the adjustment is the record
       * that survives whatever the quantity does afterwards.
       */
      await log({
        entity: 'stockAdjustment',
        op: 'create',
        targetId: newId(),
        payload: {
          itemId,
          delta,
          reason,
          occurredAt: Date.now(),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
      });

      // Clamped and rounded the way the feed drawdown does it: `quantity` is
      // non-negative in the contract, and a shelf cannot go below empty even
      // when somebody says more went than was ever there.
      const next = Math.max(0, Math.round((item.quantity + delta) * 100) / 100);

      await log({
        entity: 'inventory',
        op: 'update',
        targetId: itemId,
        payload: { quantity: next },
      });
    });
  }, [save, log, item, itemId, amount, up, reason, note]);

  if (items === null) return <Loading title="What happened?" />;
  if (item === null) return <Missing title="What happened?" what="That item" />;

  const after = Math.max(0, Math.round((item.quantity + (up ? amount : -amount)) * 100) / 100);

  return (
    <Screen title={item.name} subtitle={`${item.quantity} ${item.unit} on the shelf`} back>
      <Field label="What happened?">
        <Choice options={STOCK_REASONS} value={reason} onChange={setReason} labels={REASON_LABELS} />
      </Field>

      {/* Only where the reason does not already answer it. Asking somebody who
          just said "bought more" whether that is more or less is the app not
          listening. */}
      {direction === null ? (
        <Field label="Which way?">
          <Choice
            options={['down', 'up'] as const}
            value={adding ? 'up' : 'down'}
            onChange={(next) => setAdding(next === 'up')}
            labels={{ down: 'Less than I thought', up: 'More than I thought' }}
          />
        </Field>
      ) : null}

      <Field label="How much?">
        <Stepper value={amount} onChange={setAmount} steps={[1, 5]} suffix={item.unit} />
      </Field>

      <Field label="Anything worth remembering?" hint="Optional. 'Chewed through the corner.'">
        <TextField
          value={note}
          onChangeText={setNote}
          placeholder="Mice in the back of the barn"
          maxLength={500}
          multiline
          testID="adjust-note"
        />
      </Field>

      {/**
        * Said before the press, not after it.
        *
        * The stepper on the card changes a number with nothing to read; this
        * screen moves the same number and shows where it lands, because a
        * quantity that changes without warning is a quantity a farm stops
        * trusting.
        */}
      <Panel label="After this">
        <Body>
          {amount === 0
            ? `${item.name} stays at ${item.quantity} ${item.unit}.`
            : `${item.name} goes to ${after} ${item.unit}, and the reason is kept.`}
        </Body>
      </Panel>

      <Failure message={failure} />

      <Primary
        label={saving ? 'Recording…' : 'Record it'}
        onPress={record}
        disabled={saving || amount <= 0}
        testID="adjust-save"
      />

      {/*
        What has already happened to this sack, under the form for recording
        the next thing.

        `stockAdjustment` exists because changing a quantity said nothing —
        a sack that went from ten to six left no trace of whether it was fed
        out, sold, spilled or eaten by something — and the reasons were being
        kept with nowhere to read them. This is where somebody asks: the screen
        they are already on when they wonder how the last two bags went.

        Here rather than on a detail screen of its own, because §4's one
        farm-wide inventory model is going to reshape what an item *is* — the
        kinds, and movements linked to the event that consumed them — and a
        detail screen built against today's shape would be built twice.
      */}
      <Timeline subject={itemId} label="What happened to it" />
    </Screen>
  );
}
