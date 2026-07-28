import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { MORTALITY_CAUSES } from '@steading/contracts';
import { listGroups, lossesByGroup } from '@steading/core/read/groups';
import {
  Choice,
  Failure,
  Field,
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
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, TYPE } from '../theme/tokens';

/**
 * A death, a cull, or a predator.
 *
 * The record nobody wants to make and every farm has to. It is here rather
 * than folded into the group edit screen because a loss is an observation with
 * a date and a cause, not a correction to a head count — a keeper who tracks
 * causes learns which fence to fix, and a keeper who just decrements a number
 * learns nothing.
 *
 * **A predator sighting is recorded separately as well.** They are different
 * facts: a fox seen at dusk is worth knowing even on a night nothing was
 * taken, and losing three birds is worth knowing even if nobody saw what did
 * it. Choosing "predator" here offers to record both.
 */

type Cause = (typeof MORTALITY_CAUSES)[number];

const LABELS: Record<Cause, string> = {
  predator: 'Predator',
  illness: 'Illness',
  injury: 'Injury',
  age: 'Old age',
  cull: 'Culled',
  unknown: 'Do not know',
  other: 'Something else',
};

export function LossScreen({ route }: ScreenProps<'Loss'>): React.ReactElement {
  const { groupId } = route.params;
  const nav = useNav();
  const log = useLog();
  const { colors } = useTheme();

  const groups = useLive(listGroups);
  const losses = useLive(lossesByGroup);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const [count, setCount] = useState(1);
  const [cause, setCause] = useState<Cause>('unknown');
  const [predator, setPredator] = useState('');
  const [note, setNote] = useState('');

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const commit = useCallback(() => {
    void save(async () => {
      const occurredAt = Date.now();

      await log({
        entity: 'mortality',
        op: 'create',
        payload: {
          occurredAt,
          flockId: groupId,
          count,
          cause,
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
      });

      /**
       * The sighting, when they named what took them.
       *
       * Two records rather than one field, because a sighting with no loss and
       * a loss with no sighting are both ordinary and neither fits inside the
       * other. Enqueued after the mortality so the loss is durable first —
       * that is the record that must not be missing.
       */
      if (cause === 'predator' && predator.trim() !== '') {
        await log({
          entity: 'predator',
          op: 'create',
          payload: {
            occurredAt,
            species: predator.trim(),
            lossCount: count,
          },
        });
      }
    });
  }, [save, log, groupId, count, cause, note, predator]);

  if (groups === null) return <Loading title="Loss" />;
  if (group === null) return <Missing title="Loss" what="That group" />;

  const already = losses?.get(groupId) ?? 0;

  return (
    <Screen title="Record a loss" back>
      <Text style={[styles.label, { color: colors.muted }]}>{group.name}</Text>

      <Field label="How many?">
        <Stepper value={count} onChange={setCount} steps={[1, 5]} min={1} suffix="head" />
      </Field>

      <Field label="What happened?">
        <Choice options={MORTALITY_CAUSES} value={cause} onChange={setCause} labels={LABELS} />
      </Field>

      {cause === 'predator' ? (
        <Field
          label="What took them? (optional)"
          hint="Recorded as a sighting too, so a pattern across the year is visible."
        >
          <TextField value={predator} onChangeText={setPredator} placeholder="Fox, hawk, dog" maxLength={80} />
        </Field>
      ) : null}

      <Field label="Anything else? (optional)">
        <TextField value={note} onChangeText={setNote} multiline maxLength={500} />
      </Field>

      <Panel label="What this does not do">
        <Body>
          The head count on {group.name} stays as you set it. This app does not quietly subtract
          from it, because that number is what you say is there — and two things editing it
          would disagree the first time you corrected one by hand.
          {already > 0 ? ` ${already} recorded so far.` : ''}
        </Body>
      </Panel>

      <Failure message={failure} />

      <Primary
        label={`Record ${count === 1 ? 'it' : `${count} lost`}`}
        disabled={saving}
        onPress={commit}
        testID="save-loss"
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
