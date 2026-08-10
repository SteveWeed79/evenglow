import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { lastFedByGroup, listGroups } from '@steading/core/read/groups';
import { listInventory } from '@steading/core/read/iron';
import {
  Choice,
  Failure,
  Field,
  NumberField,
  Secondary,
  TextField,
  useSaver,
} from '../components/Form';
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
 * Chick starter is not goat feed, so a sack that says who it is for sorts to
 * the front for those animals — and stays offered to the rest. See the note on
 * `fromShelf`: the shelf sorts and never argues.
 *
 * ## The shelf is drawn down when the sum is not a guess
 *
 * "When I log a feeding for 3 lb of layer pellets the shelf's numbers do not
 * reduce. Layer pellets should be 47 after the feeding."
 *
 * This screen used to hold the shelf still on purpose, and the reasoning was:
 * *how much of a 50 lb sack a scoop represents is a guess, and a quantity that
 * drifts away from what is on the floor is worse than one nobody touched.*
 *
 * That is right about scoops and wrong about pounds. A sack measured in `lb`,
 * picked off the shelf, fed in `lb` — fifty minus three is forty-seven, and
 * there is nothing to guess. The hold was correct for the ambiguous case and
 * was applied to the unambiguous one, which left the shelf saying 50 lb after
 * a farm had watched three of them go into a trough.
 *
 * So it draws down **only where both sides are a weight**: the item is counted
 * in lb or kg and the feed was measured in lb or kg. `pick` already treats
 * those as the same question — it copies the sack's unit into the measure — so
 * this is the condition that was already being relied on, now acted on.
 *
 * **Scoops still change nothing**, and the screen says so rather than leaving
 * somebody to notice. A scoop is a real unit on a real farm and an imprecise
 * one everywhere else; the record keeps its 907 g approximation because that
 * is what was fed, and the shelf keeps the number the farm can check against a
 * bag on the floor.
 *
 * **Last write wins**, as it does for every mutable field here. Two people
 * feeding from the same sack on two phones will both compute from fifty and
 * both write forty-seven. The envelope carries values rather than deltas, and
 * fixing that properly is a contract change rather than a screen one — the
 * shelf's own steppers are how a farm reconciles in the meantime.
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
   * The feed on the shelf: theirs first, then everything else.
   *
   * "If it's chick food, it's not for goats — well, in most cases." The hedge
   * is the design. A keeper who puts chick crumb in front of a poorly bantam,
   * or scratch in front of the goats because it is the sack that is open, is
   * doing an ordinary thing, and a shelf that argued would be one they stopped
   * filling in. So this **sorts and never filters**.
   *
   * Feed with nothing said about it sorts with theirs rather than after it: an
   * unanswered question is not a statement that the sack is for something else,
   * and every item on every shelf predates the field.
   *
   * Deduplicated by name, because two sacks of the same feed is an ordinary
   * thing to own and would otherwise draw two chips nobody can tell apart —
   * which is also a React key collision.
   */
  const fromShelf = useMemo(() => {
    const feed = (shelf ?? []).filter((item) => item.kind === 'feed');
    const suits = (item: (typeof feed)[number]): boolean =>
      item.species === undefined || (group !== null && item.species.includes(group.species));

    const names = [...feed.filter(suits), ...feed.filter((item) => !suits(item))].map(
      (item) => item.name,
    );
    return [...new Set(names)];
  }, [shelf, group]);

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

  /**
   * The sack this feed comes out of, when the sum is not a guess.
   *
   * Null unless the name matches something on the shelf AND both sides are a
   * weight. Two sacks of the same feed is an ordinary thing to own, so this
   * takes the one with the least left — you finish the open bag before
   * starting the next, which is what a farm actually does.
   */
  const sack = useMemo(() => {
    const matches = (shelf ?? []).filter(
      (item) => item.kind === 'feed' && item.name === feedType.trim(),
    );
    if (matches.length === 0) return null;

    const open = matches.filter((item) => item.quantity > 0);
    const from = open.length > 0 ? open : matches;
    return from.reduce((least, item) => (item.quantity < least.quantity ? item : least));
  }, [shelf, feedType]);

  /**
   * Whether this feed can be taken off the shelf, and it turns on one question:
   * is the amount known in the same terms the sack is counted in?
   *
   * - **lb or kg both sides** — arithmetic, nothing to guess.
   * - **scoops, and the farm has said what its scoop holds** — also arithmetic.
   *   That is the whole reason `scoopGrams` exists: the scoop was never the
   *   problem, the app guessing at it was.
   * - **scoops with no weight given, or a sack counted in bags or bales** —
   *   left alone, and the screen says why rather than leaving it to be noticed.
   */
  const drawnFrom = useMemo(() => {
    if (sack === null) return null;
    if (sack.unit !== 'lb' && sack.unit !== 'kg') return null;
    if (measure === 'scoop' && sack.scoopGrams === undefined) return null;
    return sack;
  }, [sack, measure]);

  /** Grams in one of whatever is being counted, using the sack's own scoop. */
  const gramsPer = useCallback(
    (): number => (measure === 'scoop' ? (sack?.scoopGrams ?? GRAMS.scoop) : GRAMS[measure]),
    [measure, sack],
  );

  const [scoop, setScoop] = useState('');

  /**
   * Records what this farm's scoop holds, on the sack it belongs to.
   *
   * Asked here rather than on the shelf because here is where somebody is
   * holding the scoop and wondering why the number did not move. One answer,
   * remembered, and from then on scoops are exact.
   */
  const learnScoop = useCallback(async () => {
    const said = Number(scoop);
    if (sack === null || scoop.trim() === '' || !Number.isFinite(said) || said <= 0) return;

    await log({
      entity: 'inventory',
      op: 'update',
      targetId: sack.id,
      payload: {
        scoopGrams: Math.round(said * (sack.unit === 'kg' ? GRAMS.kg : GRAMS.lb)),
      },
    });
    setScoop('');
  }, [log, sack, scoop]);

  const { failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const commit = useCallback(
    async (count: number) => {
      await save(async () => {
        const grams = Math.round(count * gramsPer());

        /**
         * How much of the sack this is, in the sack's own units — which is
         * both what comes off the shelf and what the cost is a rate of.
         *
         * Null when the amount is a guess, and the cost is null with it. See
         * `drawnFrom`: an unpriceable feeding must contribute nothing rather
         * than contribute zero, because zero is counted as free.
         */
        const taken =
          drawnFrom === null ? null : grams / GRAMS[drawnFrom.unit === 'kg' ? 'kg' : 'lb'];

        /**
         * Stamped at log time from the sack's rate, not looked up later.
         *
         * That is the whole reason an append-only log is append-only: feed
         * prices move across a season, and a chart of what a flock cost to
         * keep in April must use April's price. A read that multiplied last
         * spring's tonnage by today's sack would show a farm a cost it never
         * paid and call it history.
         */
        const costCents =
          taken === null || drawnFrom?.costCents === undefined
            ? null
            : Math.round(taken * drawnFrom.costCents);

        await log({
          entity: 'feedLog',
          op: 'create',
          payload: {
            occurredAt: Date.now(),
            flockId: groupId,
            amountGrams: grams,
            ...(feedType.trim() === '' ? {} : { feedType: feedType.trim() }),
            ...(costCents === null ? {} : { costCents }),
          },
        });

        if (drawnFrom === null || taken === null) return;

        /**
         * The record is written first and the shelf second, on purpose.
         *
         * What was fed is the fact; what is left on the shelf is bookkeeping
         * derived from it. If only one of the two survives — a crash between
         * them, a rejected mutation — the one worth keeping is the feed.
         */
        // Two decimals, and clamped: `quantity` is non-negative in the
        // contract, and a sack fed past empty says empty rather than refusing
        // the write. Rounding keeps 50 − 3 at exactly 47 instead of 46.999…
        const left = Math.max(0, Math.round((drawnFrom.quantity - taken) * 100) / 100);

        await log({
          entity: 'inventory',
          op: 'update',
          targetId: drawnFrom.id,
          payload: { quantity: left },
        });
      });
    },
    [save, log, groupId, feedType, drawnFrom, gramsPer],
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

      {/**
        * What this will do to the shelf, said before it does it.
        *
        * Both branches matter. A quantity that changes without warning is a
        * number a farm stops trusting; a quantity that does NOT change when
        * somebody expected it to is the report that led here. Saying which is
        * about to happen costs one line and removes both surprises.
        */}
      {drawnFrom !== null ? (
        <Text style={[styles.note, { color: colors.inkQuiet }]} testID="feed-shelf-note">
          Comes off the shelf — {drawnFrom.name} has {drawnFrom.quantity} {drawnFrom.unit} left.
        </Text>
      ) : sack !== null && measure === 'scoop' && (sack.unit === 'lb' || sack.unit === 'kg') ? (
        /* Only worth asking where the answer would change something. Knowing
           what a scoop holds cannot draw down a sack counted in bags. */
        <Field
          label="How much does your scoop hold?"
          hint="Say once and it is remembered for this sack. Until then a scoop is an estimate, so the log keeps it and the shelf is left alone."
        >
          <NumberField
            value={scoop}
            onChangeText={setScoop}
            placeholder="2"
            suffix={sack.unit === 'kg' ? 'kg' : 'lb'}
            accessibilityLabel="What one scoop holds"
            testID="feed-scoop-size"
          />
          <Secondary
            label="That is my scoop"
            testID="feed-scoop-save"
            onPress={() => void learnScoop()}
          />
        </Field>
      ) : sack !== null ? (
        <Text style={[styles.note, { color: colors.inkQuiet }]} testID="feed-shelf-note">
          {sack.name} is counted in {sack.unit}, which says nothing about what goes in a
          trough — so the shelf stays as it is.
        </Text>
      ) : null}

      <Tally
        label={`Feed for ${group.name}`}
        unit={measure === 'scoop' ? 'scoops' : measure}
        steps={[1, 2, 5]}
        // Sixty pounds of hay is twelve taps of the largest step. The steps
        // are right for a scoop and cannot reach a round bale; see `typed`.
        typed
        onCommit={(value) => void commit(value)}
      />

      <Failure message={failure} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { fontFamily: FONTS.body, fontSize: TYPE.body - 1, lineHeight: TYPE.body * 1.3 },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
