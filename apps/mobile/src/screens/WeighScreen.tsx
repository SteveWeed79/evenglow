import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  formatMass,
  gramsToUg,
  newId,
  ouncesToUg,
  poundsToUg,
  type UnitSystem,
} from '@steading/contracts';
import { listAnimals } from '@steading/core/read/animals';
import { latestWeightBySubject, listWeights } from '@steading/core/read/breeding';
import { listGroups } from '@steading/core/read/groups';
import {
  Choice,
  Failure,
  Field,
  NumberField,
  Primary,
  Row,
  Secondary,
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
 * A weighing.
 *
 * The number that tells a keeper a meat bird is on track before the processing
 * date arrives, and that a doe is losing condition before it is visible. One
 * figure says almost nothing; the series says everything, which is why these
 * are append-only and never overwritten.
 *
 * **Typed, not stepped.** The one place R5 gives way: 6.4 lb cannot be
 * reached by tapping, and a scale is read standing still with both hands free
 * rather than through a glove with a bucket in one.
 *
 * Stored in micrograms. Pounds and ounces are what gets typed and what gets
 * shown; the canonical integer is what gets stored, so a farm that switches to
 * metric later reads the same records back exactly rather than approximately.
 */

type Unit = 'lb' | 'oz' | 'kg' | 'g';

const UNIT_LABELS: Record<Unit, string> = {
  lb: 'Pounds',
  oz: 'Ounces',
  kg: 'Kilos',
  g: 'Grams',
};

/**
 * The two a farm is offered, and which of them it starts on.
 *
 * A metric farm being asked for pounds is the setting failing out loud. The
 * heavier unit leads because it is the answer nine weighings in ten — ounces
 * and grams are for chicks and for fibre off one animal.
 */
const UNIT_CHOICES: Record<UnitSystem, readonly [Unit, Unit]> = {
  imperial: ['lb', 'oz'],
  metric: ['kg', 'g'],
};

const TO_UG: Record<Unit, (value: number) => number> = {
  lb: poundsToUg,
  oz: ouncesToUg,
  kg: (value) => gramsToUg(value * 1000),
  g: gramsToUg,
};

/**
 * A typed box to micrograms, or null when there is no number in it.
 *
 * One parser for the single field and for every per-animal box, so an empty
 * box, a stray letter and a zero are the same non-answer everywhere. Zero is
 * excluded deliberately: a scale reading zero is a scale nobody has put an
 * animal on.
 */
function toMass(raw: string, unit: Unit): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(TO_UG[unit](value)) : null;
}

type Mode = 'each' | 'queue' | 'averaged';

const MODE_LABELS: Record<Mode, string> = {
  each: 'A box each',
  queue: 'One at a time',
  averaged: 'One average',
};

/**
 * Above this many, a box per animal stops being a form and becomes a scroll.
 *
 * Twenty-four is about a screen and a half on a handset — enough for a pen of
 * layers or a drove of weaners, and short of the point where finding the box
 * you have not filled yet is its own job. Past it the loop is kinder, and the
 * picker still offers it either way.
 */
const BOXES_MAX = 24;

export function WeighScreen({ route }: ScreenProps<'Weigh'>): React.ReactElement {
  const { groupId } = route.params;
  const log = useLog();
  const { colors } = useTheme();
  const units = useUnits();

  const groups = useLive(listGroups);
  const animals = useLive(listAnimals);
  const weights = useLive(listWeights);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const [amount, setAmount] = useState('');
  /**
   * The ones already put on the scale this sitting, in micrograms.
   *
   * **A group weighing is several animals, not one number.** This screen took
   * a single figure and defaulted it to "average across the group", so a flock
   * of seven had exactly one input — reported as *"weigh them on a flock of 7
   * only has 1 input; average is okay but it's a secondary option"*, which is
   * the right way round and was not what was built.
   *
   * It was also recording the wrong thing. `sampled` means "a group average
   * rather than one animal on a scale", and it was on by default, so a keeper
   * who weighed one bird out of seven had it stored as the average of all
   * seven. `latestWeightBySubject` and every growth curve then read it that
   * way. Individual readings kept individually are strictly better data: the
   * mean is recoverable from them and the spread is not recoverable from the
   * mean.
   *
   * Each entry becomes its own append-only `weight` record against the group,
   * which is what the schema already wanted — one animal on a scale, unnamed.
   */
  const [entries, setEntries] = useState<readonly number[]>([]);
  /**
   * `null` is "hasn't chosen", which is what lets the picker follow the farm's
   * setting without overriding a deliberate tap. The site read lands a frame
   * after mount, so a stored default would be imperial on a metric farm.
   */
  const [chosen, setChosen] = useState<Unit | null>(null);
  const [animalId, setAnimalId] = useState<string | null>(null);
  /**
   * A box each, one at a time, or one figure for the lot.
   *
   * `null` is "hasn't chosen", same as `chosen` above and for the same reason:
   * the group read lands a frame after mount, so the default has to be derived
   * from the head count once it arrives rather than fixed at mount.
   *
   * **A box per animal is the default for a group you could actually carry to
   * a scale**, asked for in those words: *"shouldn't there be a spot to enter
   * the weight of each bird in the group? or a toggle to turn that on if it's
   * a large group?"* Seven boxes you can see and fill in any order beats seven
   * trips through one box — you can tell at a glance which you have done, and
   * there is no button between one bird and the next.
   *
   * It stops being the default above `BOXES_MAX`, because forty boxes is not a
   * form, it is a scroll. The picker still offers the loop at any size.
   */
  const [mode, setMode] = useState<Mode | null>(null);
  /**
   * The per-animal boxes, held raw.
   *
   * Sparse and unsized: `boxes[i] ?? ''`, so nothing has to be allocated before
   * the group's head count is known, and a farm that weighs the third and the
   * fifth bird and no others gets exactly two records.
   */
  const [boxes, setBoxes] = useState<readonly string[]>([]);
  const [note, setNote] = useState('');

  const { saving, failure, save } = useSaver(useLeave());

  const choices = UNIT_CHOICES[units];
  // A tap made before the site read landed could name a unit the farm's system
  // does not offer. Falls back to the heavier of the two rather than showing a
  // picker with nothing selected.
  const unit: Unit = chosen !== null && choices.includes(chosen) ? chosen : choices[0];

  const massUg = toMass(amount, unit);

  /** How many are in this group, when that is more than one. */
  const herd = group !== null && group.count > 1 ? group.count : null;

  /**
   * A named animal is one number by definition — no mode, no boxes, no loop.
   * Otherwise the farm's choice, or the default the head count implies.
   */
  const active: Mode =
    animalId !== null
      ? 'averaged'
      : (mode ?? (herd !== null && herd <= BOXES_MAX ? 'each' : 'queue'));

  /** The per-animal figures, in order, skipping every box left empty. */
  const boxed: readonly number[] =
    herd === null
      ? []
      : Array.from({ length: herd }, (_, i) => toMass(boxes[i] ?? '', unit)).filter(
          (mass): mass is number => mass !== null,
        );

  /**
   * Everything that will be written if the button is pressed now.
   *
   * **The typed-but-not-added figure counts.** Somebody who weighs the last
   * bird, types it and taps the green button has said it — requiring one more
   * tap on "Add another" first would silently drop the number they are looking
   * at. That is the same fault as the service meter reading, on a different
   * screen, and it is worth naming: a value the person can see on screen must
   * never be discarded because a control they had no reason to press went
   * unpressed.
   */
  const pending: readonly number[] =
    active === 'each'
      ? boxed
      : active === 'queue'
        ? massUg === null
          ? entries
          : [...entries, massUg]
        : massUg === null
          ? []
          : [massUg];

  const weighing = active === 'queue';

  const add = useCallback(() => {
    if (massUg === null) return;
    setEntries((held) => [...held, massUg]);
    setAmount('');
  }, [massUg]);

  const commit = useCallback(() => {
    if (pending.length === 0) return;
    void save(async () => {
      /**
       * One record each, in order, never batched into an average here.
       *
       * Sequential rather than `Promise.all` for the reason every write in
       * this app is: each `log` enqueues a mutation and updates the projection
       * in one transaction, and overlapping them races `clientSeq`.
       *
       * The note goes on all of them. It describes the weighing rather than
       * any one animal — "off feed since Tuesday" is about the sitting.
       */
      for (const mass of pending) {
        await log({
          entity: 'weight',
          op: 'create',
          targetId: newId(),
          payload: {
            occurredAt: Date.now(),
            massUg: mass,
            // Exactly one subject. A weight on both a group and an animal would
            // be counted twice by anything that sums either.
            ...(animalId === null ? { flockId: groupId } : { animalId }),
            // Only for the figure that really is a group average. An unnamed
            // bird on a scale is one animal weighed, not a sample of itself —
            // which is what this flag said about every group weighing before.
            ...(animalId === null && active === 'averaged' ? { sampled: true } : {}),
            ...(note.trim() === '' ? {} : { note: note.trim() }),
          },
        });
      }
    });
  }, [save, log, pending, animalId, groupId, active, note]);

  if (groups === null) return <Loading title="Weight" />;
  if (group === null) return <Missing title="Weight" what="That group" />;

  const named = (animals ?? []).filter((a) => a.flockId === groupId);
  const subject = animalId ?? groupId;
  const previous = weights === null ? undefined : latestWeightBySubject(weights).get(subject);

  /**
   * The form keeps its column; the pane carries what you would otherwise have
   * to remember.
   *
   * **A form is never two columns.** The eye zigzags, focus order stops
   * matching reading order, and a failed save becomes ambiguous about which
   * side it belongs to. That rule is in `docs/LANDSCAPE-PLAN.md` and it is not
   * bent here — every field stays in the 600dp column exactly where it is on a
   * phone.
   *
   * What the second column is for is *context for the thing being logged*.
   * Weighing an animal beside the last three weighings is a better form than
   * weighing it alone: it is the difference between typing a number and
   * knowing whether the number is plausible. On a narrow window it restacks
   * underneath, which is where a person would have had to scroll for it
   * anyway — nothing is lost, it is just further away.
   */
  const history = (weights ?? [])
    .filter((entry) => (entry.animalId ?? entry.flockId) === subject)
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, 3);

  return (
    <Screen
      title="Weigh"
      back
      {...(history.length === 0
        ? {}
        : {
            aside: (
              <Panel label="Last three">
                {history.map((entry) => (
                  <View key={entry.id} style={styles.past}>
                    <Text style={[styles.label, { color: colors.muted }]}>
                      {new Date(entry.occurredAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                    <Text style={[styles.pastMass, { color: colors.ink }]}>
                      {formatMass(entry.massUg, units)}
                    </Text>
                  </View>
                ))}
              </Panel>
            ),
          })}
    >
      <Text style={[styles.label, { color: colors.muted }]}>{group.name}</Text>

      {named.length > 0 ? (
        <Field label="Who?">
          <Choice
            options={['group', ...named.map((a) => a.id)] as const}
            value={animalId ?? 'group'}
            onChange={(next) => setAnimalId(next === 'group' ? null : next)}
            labels={{
              group: `The whole ${group.name}`,
              ...Object.fromEntries(named.map((a) => [a.id, a.name])),
            }}
          />
        </Field>
      ) : null}

      {/**
        * The head count is the frame, and leaving it out was the whole fault.
        *
        * Reported twice: *"I thought you fixed the weight being only a single
        * measurement?"*, then **"there are 7 birds in that flock… 1 weight
        * makes little sense."** The second is the sharper one. Everything was
        * already there — one field, an "Add and weigh another" button, the
        * average demoted to a toggle — and the screen still asked "How much?"
        * as though one number were the answer, because it never mentioned that
        * it knew there were seven.
        *
        * It has known all along: `group.count` is right there. So the label
        * counts against it — "2 of 7 weighed" — and the empty state says what
        * is being asked for rather than leaving somebody to infer it from a
        * button that is disabled until they type.
        *
        * A group of one gets neither, because "1 of 1" is a screen being
        * pleased with itself.
        */}
      {/**
        * How this group is being weighed, said before anything is typed.
        *
        * Asked for directly — *"shouldn't there be a spot to enter the weight
        * of each bird in the group? or a toggle to turn that on if it's a
        * large group?"* — and it replaces the single "averaged" toggle, which
        * could only ever say what this screen was NOT doing.
        *
        * Three named things beat two toggles: a box each, one at a time, or
        * one figure for the lot. A group of one has nothing to choose between.
        */}
      {animalId === null && herd !== null ? (
        <Field label="How are you weighing them?">
          <Choice
            options={herd <= BOXES_MAX ? (['each', 'queue', 'averaged'] as const) : (['queue', 'averaged'] as const)}
            value={active}
            onChange={(next) => {
              setMode(next);
              // Nothing carries between modes. An average logged alongside six
              // individuals would double every total that sums either, and a
              // box left filled behind a mode nobody can see is worse.
              setEntries([]);
              setBoxes([]);
              setAmount('');
            }}
            labels={MODE_LABELS}
          />
        </Field>
      ) : null}

      <Field label="In">
        <Choice options={choices} value={unit} onChange={setChosen} labels={UNIT_LABELS} />
      </Field>

      {/**
        * One box per animal, numbered, and every one of them optional.
        *
        * Numbered rather than named because these animals have no names — a
        * flock of seven is seven birds, not seven records. The number is a
        * place on the screen so somebody can see which they have done, and it
        * is deliberately not stored: nothing claims bird 3 is the same bird as
        * bird 3 last month, because nothing knows that.
        */}
      {active === 'each' && herd !== null ? (
        <Field
          label={boxed.length > 0 ? `${boxed.length} of ${herd} weighed` : `All ${herd}, or as many as you weigh`}
          hint="Leave the ones you did not weigh empty."
        >
          {Array.from({ length: herd }, (_, index) => (
            <NumberField
              key={index}
              value={boxes[index] ?? ''}
              onChangeText={(next) =>
                setBoxes((held) => {
                  const copy = [...held];
                  while (copy.length <= index) copy.push('');
                  copy[index] = next;
                  return copy;
                })
              }
              placeholder={`${index + 1}`}
              suffix={unit}
              accessibilityLabel={`Weight ${index + 1} of ${herd}`}
              testID={`weight-box-${index}`}
            />
          ))}
        </Field>
      ) : (
        <Field label={weighLabel(weighing, entries.length, herd)} {...weighHint(weighing, entries.length, herd)}>
          <NumberField
            value={amount}
            onChangeText={setAmount}
            placeholder="6.4"
            suffix={unit}
            accessibilityLabel="Weight"
            testID="weight-amount"
          />
        </Field>
      )}



      {weighing && entries.length > 0 ? (
        <Panel label={`On the scale so far — ${describeSpread(entries, units)}`}>
          {/* Tap to take one back. A misread scale is the ordinary mistake
              here and it must not cost the other six. */}
          {entries.map((mass, index) => (
            <Row
              key={`${mass}-${index}`}
              title={formatMass(mass, units)}
              detail="Tap to take this one off"
              testID={`weight-entry-${index}`}
              onPress={() => setEntries((held) => held.filter((_, at) => at !== index))}
            />
          ))}
        </Panel>
      ) : null}

      {active === 'each' && boxed.length > 1 ? (
        <Panel label={`So far — ${describeSpread(boxed, units)}`}>
          <Body>The average and the spread, which one figure could never have given you.</Body>
        </Panel>
      ) : null}

      {previous ? (
        <Panel label="Last time">
          <Body>
            {formatMass(previous.massUg, units)} on{' '}
            {new Date(previous.occurredAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
            })}
            {massUg === null ? '.' : ` — ${describeChange(previous.massUg, massUg, units)}`}
          </Body>
        </Panel>
      ) : null}

      <Field label="Anything else? (optional)">
        <TextField value={note} onChangeText={setNote} multiline maxLength={300} />
      </Field>

      <Failure message={failure} />

      {/**
        * Carrying on is the green button; finishing is the quiet one.
        *
        * **This ranking was the wrong way round and it ejected people.**
        * "Add and weigh another" was the secondary control and the commit was
        * the Primary, so somebody with seven birds typed the first weight,
        * pressed the obvious green button, and was returned to Today having
        * logged one — reported exactly that way, alongside *"is the user
        * expected to open and use the screen for each bird? That seems lazy on
        * our end."*
        *
        * It was. On a group, weighing the next one is what happens six times
        * out of seven and finishing happens once, so the loud control is the
        * loop and the exit is deliberate. R1 is untouched: the five-second
        * rule is about how fast a log can be *started*, and this makes the
        * repeated act cheaper rather than dearer.
        *
        * A named animal, or an averaged figure, is one number by definition —
        * there is no loop, so it keeps the single commit it always had.
        */}
      {weighing ? (
        <>
          <Primary
            label="Add and weigh the next"
            disabled={saving || massUg === null}
            onPress={add}
            testID="weight-add"
          />
          {pending.length === 0 ? null : (
            <Secondary
              label={finishLabel(pending, units)}
              onPress={commit}
              testID="save-weight"
            />
          )}
        </>
      ) : active === 'each' ? (
        /* No loop to carry on with: every box is already on screen, so the
           only button is the one that writes them. */
        <Primary
          label={buttonLabel(pending, units)}
          disabled={saving || pending.length === 0}
          onPress={commit}
          testID="save-weight"
        />
      ) : (
        <Primary
          label={buttonLabel(pending, units)}
          disabled={saving || pending.length === 0}
          onPress={commit}
          testID="save-weight"
        />
      )}
    </Screen>
  );
}

/**
 * The exit, which says both what it writes and that it is the end.
 *
 * "Done" leads, because the thing somebody needs to know about this button is
 * that it stops the loop — the count is the confirmation, not the invitation.
 */
function finishLabel(pending: readonly number[], units: UnitSystem): string {
  if (pending.length === 1) return `Done — log ${formatMass(pending[0]!, units)}`;
  return `Done — log ${pending.length} weights`;
}

/** What is about to be written, counted rather than guessed at. */
function buttonLabel(pending: readonly number[], units: UnitSystem): string {
  if (pending.length === 0) return 'Weigh';
  if (pending.length === 1) return `Log ${formatMass(pending[0]!, units)}`;
  return `Log ${pending.length} weights`;
}

/**
 * The average and the range, which is the pair that actually tells a keeper
 * something.
 *
 * A mean of 6.4 lb across seven birds reads the same whether they are all
 * within an ounce of each other or whether two are a pound behind — and the
 * second is the one worth walking back out to look at. This is the readout
 * that a single averaged figure could never have produced, and the reason
 * individual entries are the better record rather than merely the tidier one.
 */
function describeSpread(entries: readonly number[], units: UnitSystem): string {
  const mean = Math.round(entries.reduce((sum, mass) => sum + mass, 0) / entries.length);
  if (entries.length === 1) return formatMass(mean, units);

  const low = Math.min(...entries);
  const high = Math.max(...entries);
  if (low === high) return `${formatMass(mean, units)} each`;

  return `${formatMass(mean, units)} average, ${formatMass(low, units)} to ${formatMass(high, units)}`;
}

/** Up, down or level — the only part of the number anyone reads twice. */
function describeChange(before: number, now: number, units: UnitSystem): string {
  const delta = now - before;
  if (delta === 0) return 'no change';
  const direction = delta > 0 ? 'up' : 'down';
  return `${direction} ${formatMass(Math.abs(delta), units)}`;
}

const styles = StyleSheet.create({
  /**
   * A past weighing: the date quiet, the mass loud.
   *
   * A row rather than a stack, because three of these are read as a column of
   * numbers with dates beside them — the shape a person scans for "is it going
   * up" — not as three little cards.
   */
  past: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  pastMass: { fontFamily: FONTS.display, fontSize: TYPE.title, fontVariant: ['tabular-nums'] },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});

/**
 * What the box is asking for, counted against the group.
 *
 * "2 of 7 weighed" rather than "2 done": the denominator is the fact that
 * makes a single reading look wrong, and it is the one the screen was keeping
 * to itself.
 */
function weighLabel(weighing: boolean, done: number, herd: number | null): string {
  if (!weighing) return 'How much?';
  if (herd === null) return done > 0 ? `Next one (${done} done)` : 'How much?';
  return done > 0 ? `Next one — ${done} of ${herd} weighed` : `How much? (${herd} in this group)`;
}

/** Said once, on the empty box, and then the count above carries it. */
function weighHint(weighing: boolean, done: number, herd: number | null): { hint?: string } {
  if (!weighing || done > 0) return {};
  return {
    hint:
      herd === null
        ? 'Add each one and the box clears for the next.'
        : `Weigh them one at a time — add each and the box clears for the next. ` +
          `You do not have to do all ${herd}.`,
  };
}
