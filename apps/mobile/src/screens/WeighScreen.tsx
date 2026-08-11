import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
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
  Toggle,
  useSaver,
} from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
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

export function WeighScreen({ route }: ScreenProps<'Weigh'>): React.ReactElement {
  const { groupId } = route.params;
  const nav = useNav();
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
   * Off by default now, and that is the change.
   *
   * One figure standing for the whole group is a real thing a farm does — a
   * pen of forty broilers is not going on a scale one at a time — so it stays.
   * It is the fallback rather than the assumption.
   */
  const [averaged, setAveraged] = useState(false);
  const [note, setNote] = useState('');

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const choices = UNIT_CHOICES[units];
  // A tap made before the site read landed could name a unit the farm's system
  // does not offer. Falls back to the heavier of the two rather than showing a
  // picker with nothing selected.
  const unit: Unit = chosen !== null && choices.includes(chosen) ? chosen : choices[0];

  const value = Number(amount);
  const massUg =
    Number.isFinite(value) && value > 0 ? Math.round(TO_UG[unit](value)) : null;

  /** Several readings, or the one that is standing in for all of them. */
  const weighing = animalId === null && !averaged;

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
    weighing
      ? massUg === null
        ? entries
        : [...entries, massUg]
      : massUg === null
        ? []
        : [massUg];

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
            ...(animalId === null && averaged ? { sampled: true } : {}),
            ...(note.trim() === '' ? {} : { note: note.trim() }),
          },
        });
      }
    });
  }, [save, log, pending, animalId, groupId, averaged, note]);

  if (groups === null) return <Loading title="Weight" />;
  if (group === null) return <Missing title="Weight" what="That group" />;

  const named = (animals ?? []).filter((a) => a.flockId === groupId);
  const subject = animalId ?? groupId;
  const previous = weights === null ? undefined : latestWeightBySubject(weights).get(subject);

  return (
    <Screen title="Weigh" back>
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

      <Field
        label={weighing && entries.length > 0 ? `Next one (${entries.length} done)` : 'How much?'}
      >
        <NumberField
          value={amount}
          onChangeText={setAmount}
          placeholder="6.4"
          suffix={unit}
          accessibilityLabel="Weight"
          testID="weight-amount"
        />
      </Field>

      <Field label="In">
        <Choice options={choices} value={unit} onChange={setChosen} labels={UNIT_LABELS} />
      </Field>

      {/* Add, then the next one, without leaving the screen. A group of seven
          is seven numbers and six of these taps — the whole reason this is not
          a single field any more. */}
      {weighing ? (
        <Secondary
          label="Add and weigh another"
          disabled={massUg === null}
          onPress={add}
          testID="weight-add"
        />
      ) : null}

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

      {animalId === null ? (
        /* Last, and off by default. It is a real thing a farm does — forty
           broilers are not going on a scale one at a time — but it is the
           fallback, not the assumption, and turning it on says what it costs. */
        <Toggle
          label="One figure, averaged across the whole group"
          value={averaged}
          onChange={(on) => {
            setAveraged(on);
            // Switching modes must not carry readings across: an average is
            // one record, and silently logging six individuals alongside it
            // would double every total.
            if (on) setEntries([]);
          }}
        />
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

      <Primary
        label={buttonLabel(pending, units)}
        disabled={saving || pending.length === 0}
        onPress={commit}
        testID="save-weight"
      />
    </Screen>
  );
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
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
