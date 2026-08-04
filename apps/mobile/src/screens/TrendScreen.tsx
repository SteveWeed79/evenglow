import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import {
  type Currency,
  dailyProductsOf,
  formatMass,
  formatMoney,
  formatRate,
  type Product,
} from '@steading/contracts';
import { feedCostPerEgg, feedSpend, type PerEgg } from '@steading/core/read/cost';
import { listGroups } from '@steading/core/read/groups';
import {
  direction,
  eggTrend,
  feedTrend,
  type Grain,
  type Point,
  produceTrend,
} from '@steading/core/read/trend';
import { Choice } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Trend } from '../components/Trend';
import { useLive } from '../hooks/useLive';
import { useCurrency, useUnits } from '../hooks/useUnits';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, TYPE } from '../theme/tokens';

/**
 * What a group has done over a season.
 *
 * ## The gap this closes
 *
 * There was not one chart in the app. A farm could log every morning for a
 * year and had no way to see whether the flock was slowing down, which is the
 * difference between a logbook and a tool — and the reason people buy the
 * competition. Every read this needs already existed; nothing rendered them
 * over time.
 *
 * ## Production against feed, on one screen
 *
 * They are the two halves of the same question. Eggs falling is a fact; eggs
 * falling while feed is flat is a different fact from eggs falling because
 * nobody has fed them, and a farm that sees only the first will go looking for
 * a disease that is not there.
 *
 * Deliberately NOT combined into one axis. Grams of feed and counts of eggs
 * are not comparable quantities, and a dual-axis chart is the classic way to
 * make two unrelated lines look like a cause. Two charts, one above the other,
 * over the same weeks.
 *
 * ## Weeks and months, and nothing finer
 *
 * A day is noise — collecting twice on Saturday and not at all on Sunday is
 * not a change in lay rate. Twelve weeks is a season; twelve months is the
 * comparison a second year makes possible, which is what a farm keeps records
 * for in the first place.
 */

const GRAIN_LABELS: Record<Grain, string> = { week: '12 weeks', month: '12 months' };

const PRODUCT_LABELS: Record<Product, string> = { eggs: 'Eggs', milk: 'Milk', fibre: 'Fibre' };
const PRODUCT_UNITS: Record<Product, string> = { eggs: 'eggs', milk: 'ml', fibre: 'g' };

export function TrendScreen({ route }: ScreenProps<'Trend'>): React.ReactElement {
  const { groupId } = route.params;
  const [grain, setGrain] = useState<Grain>('week');
  const units = useUnits();
  const currency = useCurrency();

  const groups = useLive(listGroups);
  const group = groups?.find((one) => one.id === groupId) ?? null;

  /**
   * What to chart, as a string.
   *
   * `group` is rebuilt by every re-read, so a reader that depended on it would
   * change identity each time and `useLive` would resubscribe — see the note
   * on `subscribe`. Only the products matter here, and they compare by value.
   */
  const products =
    group === null ? null : dailyProductsOf(group.species, group.purposes ?? []).join(',');

  const read = useCallback(async () => {
    // Null is "no such group"; empty is a real group that produces nothing
    // daily, and that has an answer of its own below.
    if (products === null) return null;

    const wanted = (products === '' ? [] : products.split(',')) as Product[];
    const series = await Promise.all(
      wanted.map(async (product) => ({
        product,
        points:
          product === 'eggs'
            ? await eggTrend(groupId, grain, 12)
            : await produceTrend(groupId, product, grain, 12),
      })),
    );

    const [feed, spend, perEgg] = await Promise.all([
      feedTrend(groupId, grain, 12),
      feedSpend(groupId, grain, 12),
      // The window the rate is over matches the chart above it, so the two
      // are answers to the same question rather than to two different ones.
      feedCostPerEgg(groupId, grain === 'week' ? 84 : 365),
    ]);

    return { series, feed, spend, perEgg };
  }, [products, groupId, grain]);

  const data = useLive(read, 'the numbers');

  if (groups === null) return <Loading title="Numbers" />;
  if (group === null) return <Missing title="Numbers" what="That group" />;

  return (
    <Screen title={group.name} back>
      <Choice
        options={['week', 'month'] as const}
        value={grain}
        onChange={setGrain}
        labels={GRAIN_LABELS}
      />

      {data === null ? null : data.series.length === 0 ? (
        <Panel label="Nothing to chart yet">
          <Body>
            None of this group&rsquo;s purposes is something collected daily. Change what it is
            kept for under Stock and what it produces appears here.
          </Body>
        </Panel>
      ) : (
        data.series.map(({ product, points }) => (
          <Chart
            key={product}
            title={PRODUCT_LABELS[product]}
            unit={PRODUCT_UNITS[product]}
            points={points}
            testID={`trend-${product}`}
          />
        ))
      )}

      {data === null || data.feed.every((point) => point.amount === 0) ? null : (
        <Chart
          title="Feed"
          unit=""
          points={data.feed}
          // Stored in grams; `formatMass` speaks micrograms, and the farm
          // reads whichever system it set.
          format={(grams) => formatMass(grams * 1_000_000, units)}
          testID="trend-feed"
        />
      )}

      {data === null || data.spend.every((point) => point.amount === 0) ? null : (
        <Chart
          title="What the feed cost"
          unit=""
          points={data.spend}
          format={(minor) => formatMoney(minor, currency)}
          testID="trend-spend"
        />
      )}

      {data === null ? null : <PerEggPanel per={data.perEgg} grain={grain} currency={currency} />}
    </Screen>
  );
}

/**
 * Cost per egg — the number this whole feature exists for.
 *
 * A smallholding cannot get it out of a spreadsheet without an afternoon's
 * work, so everybody has an opinion about it and nobody has evidence.
 *
 * **It says "in feed", always.** Feed is between sixty and seventy-five per
 * cent of what a laying flock costs, which is what makes a feed-only figure
 * worth having and also what makes an unqualified one false. A screen that
 * said "3.4¢ an egg" would have quietly told a farm something untrue.
 *
 * **It refuses rather than guesses.** A window where only half the feedings
 * carried a price divides a half-sized cost by a full-sized egg count and
 * reports half the real figure — which is worse than saying nothing, because
 * it looks like an answer. Under four fifths priced, this says what is missing
 * and how to fix it instead.
 */
function PerEggPanel({
  per,
  grain,
  currency,
}: {
  per: PerEgg;
  grain: Grain;
  currency: Currency;
}): React.ReactElement | null {
  const { colors } = useTheme();

  // Nothing bought and nothing fed is a farm that has not started, not a farm
  // with a problem. Silence rather than an explanation nobody asked for.
  if (per.feedings === 0) return null;

  const window = grain === 'week' ? 'twelve weeks' : 'year';
  const priced = per.feedings === 0 ? 0 : per.costed / per.feedings;

  if (per.costed === 0) {
    return (
      <Panel label="Cost per egg">
        <Body>
          None of the feed logged in the last {window} has a price on it. Put what a sack cost on
          the shelf entry and this fills in by itself — no extra thing to remember at feeding
          time.
        </Body>
      </Panel>
    );
  }

  if (priced < 0.8 || per.minorPerEgg === null) {
    return (
      <Panel label="Cost per egg">
        <Body>
          {per.costed} of the last {per.feedings} feeds have a price on them
          {per.eggs === 0 ? ', and no eggs are logged for this window' : ''}. A figure built from
          part of the feed would read low and look right, so it is not shown until most of it is
          priced.
        </Body>
      </Panel>
    );
  }

  return (
    <Panel label="Cost per egg">
      <Text style={[styles.figure, { color: colors.ink }]} testID="cost-per-egg">
        {formatRate(per.minorPerEgg, currency)}
      </Text>
      <Body>
        In feed, over the last {window} — {formatMoney(per.spent, currency)} across {per.eggs}{' '}
        eggs. Feed is most of what a flock costs but not all of it, so the true figure is a little
        higher.
      </Body>
    </Panel>
  );
}

function Chart({
  title,
  unit,
  points,
  format,
  testID,
}: {
  title: string;
  unit: string;
  points: Point[];
  format?: (amount: number) => string;
  testID: string;
}): React.ReactElement {
  const { colors } = useTheme();
  const moved = direction(points);
  const total = points.reduce((sum, point) => sum + point.amount, 0);

  return (
    <Panel label={title}>
      {total === 0 ? (
        <Body>Nothing logged in this window yet. It fills in as you go.</Body>
      ) : (
        <>
          <Trend
            points={points}
            unit={unit}
            {...(format === undefined ? {} : { format })}
            testID={testID}
          />

          {/* The sentence, which is the part that survives being read at arm's
              length. See `direction` for why it skips the bucket in progress. */}
          <Text style={[styles.said, { color: colors.ink }]} testID={`${testID}-said`}>
            {say(moved, unit, format)}
          </Text>
        </>
      )}
    </Panel>
  );
}

/** What the chart means, in a sentence a farm can act on. */
function say(
  moved: ReturnType<typeof direction>,
  unit: string,
  format?: (amount: number) => string,
): string {
  const { latest, changePercent } = moved;
  if (latest === null) return 'Not enough yet to say which way it is going.';

  const amount = format === undefined ? `${latest.amount} ${unit}` : format(latest.amount);
  const last = `${amount} last time round`;

  if (changePercent === null) return `${last}. Nothing before it to compare with.`;
  // Five per cent either way is a farm having a slightly different week, not a
  // trend. Calling that a change is how a chart teaches somebody to ignore it.
  if (Math.abs(changePercent) < 5) return `${last}, about the same as before.`;

  return changePercent > 0
    ? `${last}, up ${changePercent}% on the one before.`
    : `${last}, down ${Math.abs(changePercent)}% on the one before.`;
}

const styles = StyleSheet.create({
  said: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  // Large, because it is the one figure on this screen somebody came for.
  figure: { fontFamily: FONTS.data, fontSize: TYPE.hero, letterSpacing: 0.5 },
});
