import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { formatMass, gramsToUg, newId, poundsToUg } from '@steading/contracts';
import { listAnimals } from '@steading/core/read/animals';
import { listGroups } from '@steading/core/read/groups';
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
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { useUnits } from '../hooks/useUnits';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, TYPE } from '../theme/tokens';

/**
 * A clip.
 *
 * The app has offered **fibre** as a purpose since purposes existed, filters
 * species by whether they carry it, and had nowhere to record the one event
 * that purpose is about. A keeper who ticked fibre was promised something that
 * did not exist — which is the exact shape of gap the roadmap's second rule is
 * for.
 *
 * ## Greasy weight, and it says so
 *
 * `shearingShape` calls it "greasy weight, as it comes off" for a reason: a
 * fleece loses between a quarter and a half its weight at scouring, and a farm
 * comparing this year's clip against last needs both years measured the same
 * way. The screen names it rather than letting somebody guess, because a
 * skirted figure entered here once makes the whole series a lie.
 *
 * ## One unit, whichever the farm reads in
 *
 * The weigh screen offers a second, smaller unit because a chick is weighed in
 * ounces. A fleece is not, and the choice would be one nobody uses standing in
 * a shed with a scale and a bag — so this takes pounds or kilos off the farm's
 * setting and never asks.
 */

export function ShearingScreen({ route }: ScreenProps<'Shearing'>): React.ReactElement {
  const { groupId } = route.params;
  const nav = useNav();
  const log = useLog();
  const { colors } = useTheme();
  const units = useUnits();

  const groups = useLive(listGroups);
  const animals = useLive(listAnimals);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const [amount, setAmount] = useState('');
  const [animalId, setAnimalId] = useState<string | null>(null);
  const [animalsShorn, setAnimalsShorn] = useState(1);
  const [note, setNote] = useState('');

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const heavy = units === 'metric' ? 'kg' : 'lb';

  const value = Number(amount);
  const massUg =
    Number.isFinite(value) && value > 0
      ? Math.round(units === 'metric' ? gramsToUg(value * 1000) : poundsToUg(value))
      : null;

  const commit = useCallback(() => {
    if (massUg === null) return;
    void save(async () => {
      await log({
        entity: 'shearing',
        op: 'create',
        targetId: newId(),
        payload: {
          occurredAt: Date.now(),
          massUg,
          // Exactly one subject, like a weight — the schema refuses both, and
          // a clip counted against a group and an animal would be double.
          ...(animalId === null ? { flockId: groupId } : { animalId }),
          // Only meaningful on a group total: one animal is one animal.
          ...(animalId === null ? { animalsShorn } : {}),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
      });
    });
  }, [save, log, massUg, animalId, groupId, animalsShorn, note]);

  if (groups === null) return <Loading title="Shearing" />;
  if (group === null) return <Missing title="Shearing" what="That group" />;

  const named = (animals ?? []).filter((a) => a.flockId === groupId);

  /** Per-animal average, which is the figure a fleece is actually judged on. */
  const each =
    massUg !== null && animalId === null && animalsShorn > 0
      ? formatMass(Math.round(massUg / animalsShorn), units)
      : null;

  return (
    <Screen title="Record a clip" back>
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
        label="How much came off?"
        hint="Greasy weight, straight off the animal — before skirting or washing."
      >
        <NumberField
          value={amount}
          onChangeText={setAmount}
          placeholder="7.5"
          suffix={heavy}
          accessibilityLabel="Fleece weight in pounds"
          testID="clip-amount"
        />
      </Field>

      {animalId === null ? (
        <Field label="How many were shorn?">
          <Stepper
            value={animalsShorn}
            onChange={setAnimalsShorn}
            steps={[1, 5]}
            min={1}
            suffix="shorn"
          />
        </Field>
      ) : null}

      {each === null ? null : (
        <Panel label="Which is">
          {/* The number a farm compares between years and between animals. A
              total is a fact about a day; this is a fact about the stock. */}
          <Body>{each} each, across {animalsShorn}.</Body>
        </Panel>
      )}

      <Field label="Anything else? (optional)">
        <TextField value={note} onChangeText={setNote} multiline maxLength={300} />
      </Field>

      <Failure message={failure} />

      <Primary
        label={massUg === null ? 'Record it' : `Log ${formatMass(massUg, units)}`}
        disabled={saving || massUg === null}
        onPress={commit}
        testID="save-clip"
      />
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
