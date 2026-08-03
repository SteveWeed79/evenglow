import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { lastFedByGroup, listGroups } from '@steading/core/read/groups';
import { listInventory } from '@steading/core/read/iron';
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
 *
 * ## What is on the shelf is offered here
 *
 * "I log a Chick starter on The Shelf but the option to feed my chickens it
 * does not appear. Having to enter this data twice is a time waste."
 *
 * Exactly right. The farm had already named the sack — `kind: 'feed'` on the
 * inventory — and this screen asked them to type the name again into a free
 * text box, next to a placeholder suggesting three feeds they do not own. Two
 * spellings of one sack then sit in the records, and no report can add them up.
 *
 * The chips are the shelf. The text field stays, because a handful of
 * windfalls or a neighbour's hay is a real feed that will never be on it.
 *
 * **The shelf is not decremented.** That is a deliberate hold, not an
 * oversight: how much of a 50 lb sack a scoop represents is a guess, and a
 * quantity that drifts away from what is on the floor is worse than one nobody
 * touched — the same reasoning the Loss screen gives for leaving head count
 * alone. Drawing it down wants its own decision.
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
  const shelf = useLive(listInventory);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const [measure, setMeasure] = useState<Measure>('scoop');
  const [feedType, setFeedType] = useState('');

  /**
   * The feed on the shelf, by name and deduplicated.
   *
   * Two sacks of the same feed is an ordinary thing to own and would otherwise
   * draw two identical chips — which is both a React key collision and a
   * choice between two things a person cannot tell apart.
   */
  const fromShelf = useMemo(
    () => [...new Set((shelf ?? []).filter((i) => i.kind === 'feed').map((i) => i.name))],
    [shelf],
  );

  const pick = useCallback(
    (name: string): void => {
      setFeedType(name);

      /**
       * The shelf already knows what it is measured in, so do not ask twice.
       *
       * Only where the units are the same question: `lb` and `kg` are feed
       * measures here too. A sack counted in bags or bales says nothing about
       * how much goes in a trough, so that leaves the measure alone.
       */
      const item = (shelf ?? []).find((i) => i.name === name);
      if (item?.unit === 'lb' || item?.unit === 'kg') setMeasure(item.unit);
    },
    [shelf],
  );

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

      {fromShelf.length > 0 ? (
        <Field label="From the shelf">
          {/* Empty labels on purpose: `Choice` falls back to the option
              itself, and the option is already the farm's own words for it. */}
          <Choice options={fromShelf} value={feedType} onChange={pick} labels={{}} />
        </Field>
      ) : null}

      <Field
        label={fromShelf.length > 0 ? 'Or something else (optional)' : 'What did they get? (optional)'}
      >
        <TextField
          value={feedType}
          onChangeText={setFeedType}
          placeholder="Layers pellets, hay, goat mix"
          maxLength={80}
          testID="feed-type"
        />
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
