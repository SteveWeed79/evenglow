import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { lastFedByGroup, listGroups } from '@steading/core/read/groups';
import { Choice, Failure, Field, TextField, useSaver } from '../components/Form';
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
 * What went in, and how much.
 *
 * The entity has existed since the first schema and nothing could write it.
 * Feed is the largest running cost on most smallholdings and the one thing a
 * keeper is asked about when a group stops laying, so a farm that cannot
 * record it has no answer to the first diagnostic question anybody asks.
 *
 * Stored in grams — a smallholder buys bags and scoops, and the scoop is the
 * unit that gets used twice a day. The steps below are the sizes those come
 * in, not a decimal ramp.
 */

type Measure = 'scoop' | 'lb' | 'kg';

const LABELS: Record<Measure, string> = { scoop: 'Scoops', lb: 'Pounds', kg: 'Kilos' };

/**
 * Grams per unit.
 *
 * A scoop is a real unit on a real farm and an imprecise one everywhere else;
 * two pounds is the common feed-store scoop and is the honest approximation.
 * The number stored is grams either way, so a farm that later weighs its scoop
 * has records in the same unit rather than in two.
 */
const GRAMS: Record<Measure, number> = { scoop: 907, lb: 454, kg: 1000 };

export function FeedScreen({ route }: ScreenProps<'Feed'>): React.ReactElement {
  const { groupId } = route.params;
  const nav = useNav();
  const log = useLog();
  const { colors } = useTheme();

  const groups = useLive(listGroups);
  const lastFed = useLive(lastFedByGroup);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const [measure, setMeasure] = useState<Measure>('scoop');
  const [feedType, setFeedType] = useState('');

  const { failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const commit = useCallback(
    async (count: number) => {
      await save(async () => {
        await log({
          entity: 'feedLog',
          op: 'create',
          payload: {
            occurredAt: Date.now(),
            flockId: groupId,
            amountGrams: Math.round(count * GRAMS[measure]),
            ...(feedType.trim() === '' ? {} : { feedType: feedType.trim() }),
          },
        });
      });
    },
    [save, log, groupId, measure, feedType],
  );

  if (groups === null) return <Loading title="Feed" />;
  if (group === null) return <Missing title="Feed" what="That group" />;

  const fed = lastFed?.get(groupId);

  return (
    <Screen title="Log a feed" back>
      <Text style={[styles.label, { color: colors.muted }]}>{group.name}</Text>

      {fed === undefined ? null : (
        <Panel label="Last fed">
          <Body>
            {new Date(fed).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            . Every feed is its own record — morning and evening are two, and both are true.
          </Body>
        </Panel>
      )}

      <Field label="What did they get? (optional)">
        <TextField value={feedType} onChangeText={setFeedType} placeholder="Layers pellets, hay, goat mix" maxLength={80} />
      </Field>

      <Field label="Measured in">
        <Choice options={['scoop', 'lb', 'kg'] as const} value={measure} onChange={setMeasure} labels={LABELS} />
      </Field>

      <Tally
        label={`Feed for ${group.name}`}
        unit={measure === 'scoop' ? 'scoops' : measure}
        steps={[1, 2, 5]}
        onCommit={(value) => void commit(value)}
      />

      <Failure message={failure} />
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
