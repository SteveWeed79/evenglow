import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  formatMass,
  formatProduce,
  formatRange,
  libraryBreed,
  productsOf,
  longestWithdrawal,
  SPECIES_TRAITS,
} from '@homefarm/contracts';
import { groupPhrase } from '@homefarm/core/voice';
import { latestWeightBySubject, listWeights } from '@homefarm/core/read/breeding';
import { type Group, lastFedByGroup, listGroups, lossesByGroup, produceToday } from '@homefarm/core/read/groups';
import { withdrawalsBySubject } from '@homefarm/core/read/withdrawals';
import { Row } from '../components/Form';
import { Icon } from '../components/Icon';
import { Loading, Missing } from '../components/Missing';
import { Notes } from '../components/Notes';
import { Photos } from '../components/Photos';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Coming } from '../components/Coming';
import { Timeline } from '../components/Timeline';
import { Touch } from '../components/Touch';
import { WithdrawalBanner } from '../components/WithdrawalBanner';
import { growOutWindow, layOnsetWindow } from '../hooks/useDues';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useUnits } from '../hooks/useUnits';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * One group, and everything a keeper does to it.
 *
 * The hub the app was missing. Every record type that names a `flockId` —
 * treatments, husbandry, weights, produce, feed, losses, matings — had a
 * schema, an applier and a due builder, and no way in from the UI. Stock
 * listed groups and stopped, so the withdrawal engine could never be given a
 * withdrawal and the husbandry intervals could never be told a job was done.
 *
 * Rows rather than a grid of buttons: they are read top to bottom in the order
 * a morning actually goes, and each says what it is in the farm's own words
 * rather than in the entity's.
 */
export function GroupScreen({ route }: ScreenProps<'Group'>): React.ReactElement {
  const { groupId } = route.params;

  const groups = useLive(listGroups);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  if (groups === null) return <Loading title="Stock" />;
  if (group === null) return <Missing title="Stock" what="That group" />;

  return (
    <Screen title={group.name} back>
      <GroupBody group={group} />
    </Screen>
  );
}

/**
 * One group, without a screen around it.
 *
 * Split out so the Stock hub can render it in a supporting pane beside the
 * list — the list-detail arrangement in `docs/LANDSCAPE-PLAN.md` — and split
 * by **taking the wrapper off** rather than by writing a second version. There
 * is one group hub in this app and it is this; a pane and a pushed screen that
 * were two components would be two places for a withdrawal banner to be
 * forgotten.
 *
 * Takes the record, not an id: both callers have already loaded the list it
 * came from, and it is what keeps the not-found guard on the screen, where it
 * can answer with a whole `Missing` rather than a panel inside half a layout.
 */
export function GroupBody({ group }: { group: Group }): React.ReactElement {
  const groupId = group.id;
  const nav = useNav();
  const { colors } = useTheme();
  const units = useUnits();

  const [more, setMore] = useState(false);

  const withdrawals = useLive(
    useCallback(() => withdrawalsBySubject('egg', [groupId]), [groupId]),
  );
  const produce = useLive(produceToday);
  const losses = useLive(lossesByGroup);
  const lastFed = useLive(lastFedByGroup);
  const weights = useLive(listWeights);

  const traits = SPECIES_TRAITS[group.species];

  // Eggs are excluded because they are logged on Today with the morning's
  // tally; this row is everything else the group gives.
  const produces = productsOf(group.species, group.purposes ?? []).filter(
    (product) => product !== 'eggs',
  );
  const breed = group.breedId === undefined ? undefined : libraryBreed(group.breedId);
  const withdrawal = longestWithdrawal(withdrawals?.get(groupId) ?? []);
  const grow = growOutWindow(group);
  const lay = layOnsetWindow(group);
  const lost = losses?.get(groupId) ?? 0;
  const fed = lastFed?.get(groupId);
  const weight = weights === null ? undefined : latestWeightBySubject(weights).get(groupId);

  const milked = produce?.get(`${groupId}:milk`);
  const shorn = produce?.get(`${groupId}:fibre`);

  return (
    <>
      {/* ## Said, not printed
          This line had the species' own word in it all along — herd, drove,
          gaggle — and rendered it as `CHICKENS · FLOCK · 10 HEAD ·
          AUSTRALORP`: tracked caps in the data face, the register this app
          reserves for section labels and units. A farm's own word for its own
          animals, formatted as telemetry. Same facts, said as English. */}
      <Text style={[styles.lede, { color: colors.inkQuiet }]}>
        {groupPhrase({
          collective: traits.collective,
          // "A group of 2 other" is not a sentence. An unknown species drops
          // the noun and keeps the count.
          ...(group.species === 'other'
            ? {}
            : { species: traits.label.toLowerCase(), singular: traits.singular }),
          count: group.count,
          ...(breed === undefined ? {} : { breed: breed.name }),
        })}
      </Text>

      {/* Informs, does not interrupt (R10). */}
      {withdrawal ? <WithdrawalBanner withdrawal={withdrawal} /> : null}

      {grow || lay || weight || lost > 0 || fed !== undefined ? (
        <Panel label="Where they are">
          {grow ? (
            <Body>
              Ready to process at {formatRange(grow.weeks, 'weeks')} old —{' '}
              {describeWhen(grow.opensAt)}.
            </Body>
          ) : null}
          {lay ? <Body>Expect first eggs at {formatRange(lay.weeks, 'weeks')} old.</Body> : null}
          {weight ? (
            <Body>
              Last weighed {formatMass(weight.massUg, units)}
              {weight.sampled === true ? ' — a sample, not the whole group' : ''}.
            </Body>
          ) : null}
          {/* The sack as well as the day, now that the reader keeps it. "Last
              fed yesterday" answers half the question somebody standing in
              front of the trough is actually asking. */}
          {fed === undefined ? null : (
            <Body>
              Last fed {relative(fed.at)}
              {fed.feedType === undefined ? '' : ` — ${fed.feedType}`}.
            </Body>
          )}
          {lost > 0 ? (
            <Body>
              {lost} lost since you started recording. The head count above is what you said is
              there — it is not reduced automatically.
            </Body>
          ) : null}
          {/* In the farm's own units. These two printed raw storage units for
              as long as they have existed, so an imperial farm read "3785 ml"
              here and the same milking as gallons on the produce screen. */}
          {milked ? <Body>Milked {formatProduce(milked.amount, milked.unit, units)} today.</Body> : null}
          {shorn ? (
            <Body>Took {formatProduce(shorn.amount, shorn.unit, units)} of fibre today.</Body>
          ) : null}
        </Panel>
      ) : null}

      <Notes subjectEntity="flock" subjectId={groupId} subject={group.name} />

      {/* Evidence: a wound, a kill. The one a keeper reaches for and the one
          that cannot be taken afterwards. */}
      <Photos subjectId={groupId} what={group.name} />

      {/* ## Four acts, then the rest behind a tap
          Nine rows of equal weight, each with an icon and a line of
          explanation, is eighteen lines of text and no ranking — read for the
          thousandth time by somebody who has used the app since March. It also
          exceeds Material's own ceiling for a related-action cluster (2-6) by
          half.

          The split is by how often a thing is done, not by what module it
          belongs to. A feed, a job, a treatment and a loss are the daily acts
          and keep their explanations. Weighing, produce, the named animals and
          the breeding book are occasional — they keep their place, lose the
          teaching copy, and sit behind one tap.

          **The rule was written here and then not followed**, which is how
          "Log a feed" ended up fifth. Reference rows drifted in among the
          acts one at a time, each defensible on its own — beside the thing it
          relates to — and the cumulative effect was the row a farm taps twice
          a day sitting below three it taps monthly. A principle in a comment
          is worth nothing if the list underneath it is ordered by what was
          added last.

          Nothing is removed (invariant 13): every destination that was here is
          still here. */}
      <View style={styles.rows}>
        {/* Feeding leads, because feeding is what happens most.

            It was fifth. The comment above names the four daily acts and then
            the list did not follow it: two reference rows had drifted in among
            them and a third was added with the treatments list, so the row a
            farm taps twice a day sat below three it taps monthly. Reported
            from a handset, in those words - "adding a feed is way too low on
            the list. It's the most frequent item on a farm."

            Acts first, in the order a week actually contains them. Then the
            three things you come here to READ rather than do. */}
        <Row
          title="Log a feed"
          detail="What went in, and how much"
          testID="go-feed"
          onPress={() => nav.navigate('Feed', { groupId })}
        />
        <Row
          title="Log a job done"
          detail="Worming, feet, minerals, a look-over"
          icon="check"
          testID="go-care"
          onPress={() => nav.navigate('CareLog', { groupId })}
        />
        <Row
          title="Record a treatment"
          detail="Starts the withdrawal clock on eggs, meat or milk"
          testID="go-treatment"
          onPress={() => nav.navigate('Treatment', { groupId })}
        />
        <Row
          title="Record a loss"
          detail="A death, a cull, or a predator"
          testID="go-loss"
          onPress={() => nav.navigate('Loss', { groupId })}
        />

        {/* ── and the three you come here to read ─────────────────────────

            Below the acts, because none of them is something a thumb is
            reaching for at six in the morning. They keep their order relative
            to each other: what was given, how often it comes round, what it
            all added up to. */}
        {/**
          * Below "Record a treatment" rather than beside it now.
          *
          * The adjacency was right about the subject and wrong about the
          * screen: giving a wormer is done at the pen and looking one up is
          * done because somebody asked, and only the first belongs among the
          * acts. It still carries the only way to close a course that is
          * running - an open course has its withdrawal counted from the first
          * dose, so it clears produce early until somebody closes it. See
          * `TreatmentsScreen`.
          */}
        <Row
          title="What they have had"
          detail="Every treatment, and the way to correct or close one"
          testID="go-treatments"
          onPress={() => nav.navigate('Treatments', { groupId })}
        />
        {/* The season, which is what a year of logging is FOR. Everything else
            on this screen is about today. */}
        <Row
          title="The numbers"
          detail="What they have produced over a season, against what they have eaten"
          testID="go-trend"
          onPress={() => nav.navigate('Trend', { groupId })}
        />
        {/* Last of the three, because it is the only one that is a SETTING.
            Intervals are chosen when a group is made and revisited about
            yearly; the two above are opened whenever somebody wonders. An
            earlier draft ordered these as a sentence — "what was given, how
            often it comes round, what it added up to" — which reads well and
            is not a frequency. */}
        <Row
          title="Routine jobs"
          detail="How often each one asks, or turn it off"
          testID="go-care-routine"
          onPress={() => nav.navigate('CareRoutine', { groupId })}
        />
      </View>

      <Touch affordance="disclose"
        onPress={() => setMore(!more)}
        accessibilityRole="button"
        accessibilityState={{ expanded: more }}
        accessibilityLabel={more ? 'Fewer things to do with this group' : 'More things to do with this group'}
        testID="group-more"
        hitSlop={8}
        style={({ pressed }) => [styles.more, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[styles.moreLabel, { color: colors.muted }]}>{more ? 'Fewer' : 'More'}</Text>
        <Icon name={more ? 'minus' : 'plus'} size={16} color={colors.muted} />
      </Touch>

      {more ? (
        <View style={styles.rows}>
          {/* Eggs are logged on Today with the rest of the morning's tally, so
              this is deliberately everything that is not an egg.

              **Named from what this group actually gives.** The title used to
              branch on `laysEggs` alone, so a flock of hens was offered "Milk,
              fibre or honey" — three things a chicken has never produced.
              `productsOf` intersects what the species can give with what the
              keeper says they are for.

              It still appears when there is nothing on that list, because honey
              has no species behind it yet (there are no bees in `SPECIES`) and
              `other` is the only route for anything the app has no name for. */}
          <Row
            title={producesTitle(produces)}
            testID="go-produce"
            onPress={() => nav.navigate('Produce', { groupId })}
          />
          <Row
            title="Weigh them"
            testID="go-weigh"
            onPress={() => nav.navigate('Weigh', { groupId })}
          />
          {/* Under More rather than beside "Log a feed", and the difference is
              cadence: what they were fed is twice a day, what they should be
              fed is once a season. */}
          <Row
            title="What they should get"
            detail="A ration, so the app can say when the sack runs out"
            testID="go-feed-plan"
            onPress={() => nav.navigate('FeedPlan', { groupId })}
          />
          {/* Only where the keeper said fibre. A clip on a flock of layers is
              not a thing, and offering it would be the same mistake the egg
              tally made before `productsOf` — a row nobody will ever fill in,
              every time they open the group. */}
          {(group.purposes ?? []).includes('fibre') ? (
            <Row
              title="Record a clip"
              testID="go-shearing"
              onPress={() => nav.navigate('Shearing', { groupId })}
            />
          ) : null}
          {/* Only where the keeper said meat, on exactly the clip's rule and
              for the grow-out clock's reason: a processing row on a flock of
              pet bantams is not a helpful default, it is an offensive one.

              Reachable here as well as from the due row, because a farm that
              takes a few birds early — or one whose breed the library does not
              know, so there is no countdown at all — still needs to record it.
              The due is a reminder, not the only door. */}
          {(group.purposes ?? []).includes('meat') ? (
            <Row
              title="Take them for meat"
              detail="Records what came off, and clears the processing reminder"
              testID="go-processing"
              onPress={() => nav.navigate('Processing', { groupId })}
            />
          ) : null}
          <Row
            title="Named animals"
            testID="go-animals"
            onPress={() => nav.navigate('Animals', { groupId })}
          />
          <Row
            title="Matings and births"
            testID="go-breeding"
            onPress={() => nav.navigate('Breeding', { groupId })}
          />
          <Row
            title="Change this group"
            testID="go-edit"
            onPress={() => nav.navigate('EditGroup', { groupId })}
          />
        </View>
      ) : null}

      {/* What was actually recorded against these animals, under the things
          that can be done to them. Last, because it answers a question people
          ask second — the screen leads with what to do this morning. */}
      <Coming subject={groupId} here="Group" />
      <Timeline subject={groupId} />
    </>
  );
}

const DAY_MS = 86_400_000;

/**
 * The processing date, said as a date.
 *
 * "Ready at eleven weeks old" is arithmetic somebody has to do while standing
 * in a barn holding a bird. The date is the answer they were after.
 */
function describeWhen(at: number): string {
  const days = Math.round((at - Date.now()) / DAY_MS);
  const date = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

  if (days < 0) return `that was ${date}`;
  if (days === 0) return 'that is today';
  if (days < 21) return `${date}, ${days} days away`;
  return `${date}, about ${Math.round(days / 7)} weeks away`;
}

/** Days, never a timestamp. Nobody in a yard needs to know it was 06:14. */
function relative(at: number): string {
  const days = Math.round((Date.now() - at) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

const styles = StyleSheet.create({
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SPACE.xs,
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.sm,
  },
  moreLabel: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  lede: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.4 },
  rows: { gap: SPACE.sm },
});

/**
 * Names the products rather than guessing at them.
 *
 * "Milk or fibre" for a dual-purpose goat, "Fibre" for an alpaca, and — when
 * the species gives nothing but eggs — a title that does not claim otherwise.
 */
function producesTitle(products: readonly string[]): string {
  if (products.length === 0) return 'Anything else off them';

  const named = products.map((product) => product[0]!.toUpperCase() + product.slice(1));
  if (named.length === 1) return named[0]!;
  return `${named.slice(0, -1).join(', ')} or ${named[named.length - 1]!.toLowerCase()}`;
}
