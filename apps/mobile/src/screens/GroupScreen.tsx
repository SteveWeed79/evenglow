import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  formatMass,
  formatRange,
  laysEggs,
  libraryBreed,
  longestWithdrawal,
  SPECIES_TRAITS,
} from '@steading/contracts';
import { latestWeightBySubject, listWeights } from '@steading/core/read/breeding';
import { lastFedByGroup, listGroups, lossesByGroup, produceToday } from '@steading/core/read/groups';
import { withdrawalsBySubject } from '@steading/core/read/withdrawals';
import { Row } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Notes } from '../components/Notes';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { WithdrawalBanner } from '../components/WithdrawalBanner';
import { growOutWindow, layOnsetWindow } from '../hooks/useDues';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
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
  const nav = useNav();
  const { colors } = useTheme();

  const groups = useLive(listGroups);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const withdrawals = useLive(
    useCallback(() => withdrawalsBySubject('egg', [groupId]), [groupId]),
  );
  const produce = useLive(produceToday);
  const losses = useLive(lossesByGroup);
  const lastFed = useLive(lastFedByGroup);
  const weights = useLive(listWeights);

  if (groups === null) return <Loading title="Stock" />;
  if (group === null) return <Missing title="Stock" what="That group" />;

  const traits = SPECIES_TRAITS[group.species];
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
    <Screen title={group.name} back>
      <Text style={[styles.label, { color: colors.muted }]}>
        {/* Herd, drove, gaggle — the species' own word, never "flock". */}
        {traits.label} · {traits.collective} · {group.count} head
        {breed ? ` · ${breed.name}` : ''}
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
              Last weighed {formatMass(weight.massUg, 'imperial')}
              {weight.sampled === true ? ' — a sample, not the whole group' : ''}.
            </Body>
          ) : null}
          {fed === undefined ? null : <Body>Last fed {relative(fed)}.</Body>}
          {lost > 0 ? (
            <Body>
              {lost} lost since you started recording. The head count above is what you said is
              there — it is not reduced automatically.
            </Body>
          ) : null}
          {milked ? <Body>Milked {milked.amount} ml today.</Body> : null}
          {shorn ? <Body>Took {shorn.amount} g of fibre today.</Body> : null}
        </Panel>
      ) : null}

      <Notes subjectEntity="flock" subjectId={groupId} subject={group.name} />

      <View style={styles.rows}>
        <Row
          title="Record a treatment"
          detail="Starts the withdrawal clock on eggs, meat or milk"
          icon="medication"
          testID="go-treatment"
          onPress={() => nav.navigate('Treatment', { groupId })}
        />
        <Row
          title="Log a job done"
          detail="Worming, feet, minerals, a look-over"
          icon="check"
          testID="go-care"
          onPress={() => nav.navigate('CareLog', { groupId })}
        />
        <Row
          title="Weigh them"
          detail="One animal, or a sample of the pen"
          icon="milestone"
          testID="go-weigh"
          onPress={() => nav.navigate('Weigh', { groupId })}
        />
        {/* Eggs are logged on Today with the rest of the morning's tally, so
            this is deliberately everything that is not an egg. */}
        <Row
          title={laysEggs(group.species) ? 'Milk, fibre or honey' : 'What they produce'}
          detail="Anything off them that is not an egg"
          icon="milk"
          testID="go-produce"
          onPress={() => nav.navigate('Produce', { groupId })}
        />
        <Row
          title="Log a feed"
          detail="What went in, and how much"
          icon="feed"
          testID="go-feed"
          onPress={() => nav.navigate('Feed', { groupId })}
        />
        <Row
          title="Record a loss"
          detail="A death, a cull, or a predator"
          icon="mortality"
          testID="go-loss"
          onPress={() => nav.navigate('Loss', { groupId })}
        />
        <Row
          title="Named animals"
          detail="The ones you know individually"
          icon="stock"
          testID="go-animals"
          onPress={() => nav.navigate('Animals', { groupId })}
        />
        <Row
          title="Matings and births"
          detail="Counts to a due date six weeks ahead"
          icon="date-due"
          testID="go-breeding"
          onPress={() => nav.navigate('Breeding', { groupId })}
        />
        <Row
          title="Change this group"
          detail="Name, head count, or put it away"
          icon="edit"
          testID="go-edit"
          onPress={() => nav.navigate('EditGroup', { groupId })}
        />
      </View>
    </Screen>
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
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  rows: { gap: SPACE.sm },
});
