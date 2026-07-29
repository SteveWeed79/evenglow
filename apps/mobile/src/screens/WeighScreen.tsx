import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { formatMass, newId, ouncesToUg, poundsToUg } from '@steading/contracts';
import { listAnimals } from '@steading/core/read/animals';
import { latestWeightBySubject, listWeights } from '@steading/core/read/breeding';
import { listGroups } from '@steading/core/read/groups';
import {
  Choice,
  Failure,
  Field,
  NumberField,
  Primary,
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

type Unit = 'lb' | 'oz';

const UNIT_LABELS: Record<Unit, string> = { lb: 'Pounds', oz: 'Ounces' };

export function WeighScreen({ route }: ScreenProps<'Weigh'>): React.ReactElement {
  const { groupId } = route.params;
  const nav = useNav();
  const log = useLog();
  const { colors } = useTheme();

  const groups = useLive(listGroups);
  const animals = useLive(listAnimals);
  const weights = useLive(listWeights);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<Unit>('lb');
  const [animalId, setAnimalId] = useState<string | null>(null);
  const [sampled, setSampled] = useState(true);
  const [note, setNote] = useState('');

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const value = Number(amount);
  const massUg = Number.isFinite(value) && value > 0
    ? Math.round(unit === 'lb' ? poundsToUg(value) : ouncesToUg(value))
    : null;

  const commit = useCallback(() => {
    if (massUg === null) return;
    void save(async () => {
      await log({
        entity: 'weight',
        op: 'create',
        targetId: newId(),
        payload: {
          occurredAt: Date.now(),
          massUg,
          // Exactly one subject. A weight on both a group and an animal would
          // be counted twice by anything that sums either.
          ...(animalId === null ? { flockId: groupId } : { animalId }),
          // Only meaningful for a group figure: one animal on a scale is not a
          // sample of itself.
          ...(animalId === null && sampled ? { sampled: true } : {}),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
      });
    });
  }, [save, log, massUg, animalId, groupId, sampled, note]);

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

      <Field label="How much?">
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
        <Choice options={['lb', 'oz'] as const} value={unit} onChange={setUnit} labels={UNIT_LABELS} />
      </Field>

      {animalId === null ? (
        <Toggle
          label="This is an average across the group"
          value={sampled}
          onChange={setSampled}
        />
      ) : null}

      {previous ? (
        <Panel label="Last time">
          <Body>
            {formatMass(previous.massUg, 'imperial')} on{' '}
            {new Date(previous.occurredAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
            })}
            {massUg === null ? '.' : ` — ${describeChange(previous.massUg, massUg)}`}
          </Body>
        </Panel>
      ) : null}

      <Field label="Anything else? (optional)">
        <TextField value={note} onChangeText={setNote} multiline maxLength={300} />
      </Field>

      <Failure message={failure} />

      <Primary
        label={massUg === null ? 'Weigh' : `Log ${formatMass(massUg, 'imperial')}`}
        disabled={saving || massUg === null}
        onPress={commit}
        testID="save-weight"
      />
    </Screen>
  );
}

/** Up, down or level — the only part of the number anyone reads twice. */
function describeChange(before: number, now: number): string {
  const delta = now - before;
  if (delta === 0) return 'no change';
  const direction = delta > 0 ? 'up' : 'down';
  return `${direction} ${formatMass(Math.abs(delta), 'imperial')}`;
}

const styles = StyleSheet.create({
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
