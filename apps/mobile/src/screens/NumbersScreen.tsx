import { StyleSheet, Text, View } from 'react-native';
import { formatMass } from '@steading/contracts';
import { readNumbers, type SeasonNumbers } from '@steading/core/read/numbers';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useUnits } from '../hooks/useUnits';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * What came off the farm, this season beside last.
 *
 * ## Two columns, and that is the whole design
 *
 * The single thing this app has that a notebook does not is the previous year
 * sitting next to this one. A totals screen showing only the season in progress
 * would throw away the only figure that means anything in August: what the same
 * bed did by this point last year.
 *
 * So nothing here is a lone number. Every row is a pair, and where there is no
 * pair — a farm's first season — it says so rather than printing a dash and
 * letting somebody wonder whether that is a zero.
 *
 * ## R2, and why this is not the home screen
 *
 * *"Home is today, not a dashboard. Charts live one level down."* This is one
 * level down: a row in the Farm hub, reached deliberately, never in the way of
 * a morning. It is also the closest this app comes to a dashboard, which is why
 * it follows §4's rule for the tab bar — **what a farm runs decides what it
 * sees**. A farm with no beds gets no growing section rather than an empty one.
 *
 * ## Yield, not money
 *
 * Cost data exists and is deliberately absent. What came off and what it cost
 * is a larger question needing feed apportioned between groups, a position on
 * unpaid labour and an opinion about whether a barn is a cost — and half of
 * that answered badly is worse than none of it. The yield half is useful from
 * the first picking.
 */

export function NumbersScreen(): React.ReactElement {
  const numbers = useLive(readNumbers);
  const units = useUnits();
  const { colors } = useTheme();

  if (numbers === null) return <Loading title="The numbers" />;

  const { now, before } = numbers;

  if (now.plantings === 0 && before === null) {
    return (
      <Missing
        title="The numbers"
        what="Anything picked"
      />
    );
  }

  /** A figure and the same figure a year ago, which is the only useful shape. */
  const Pair = ({
    label,
    of,
  }: {
    label: string;
    of: (s: SeasonNumbers) => string;
  }): React.ReactElement => (
    <View style={styles.pair}>
      <Text style={[styles.pairLabel, { color: colors.muted }]}>{label}</Text>
      <View style={styles.pairValues}>
        <Text style={[styles.now, { color: colors.ink }]}>{of(now)}</Text>
        <Text style={[styles.before, { color: colors.muted }]}>
          {before === null ? 'first season' : `${of(before)} by now last year`}
        </Text>
      </View>
    </View>
  );

  const weight = (s: SeasonNumbers): string =>
    s.massUg > 0 ? formatMass(s.massUg, units) : '—';
  const picked = (s: SeasonNumbers): string =>
    s.count > 0 ? `${s.count.toLocaleString()}` : '—';

  return (
    <Screen title="The numbers" subtitle={String(now.season)} back>
      <Panel label="The season so far">
        <Pair label="Picked, by weight" of={weight} />
        <Pair label="Picked, by the piece" of={picked} />
        <Pair label="Times picked" of={(s) => String(s.picks)} />
        <Pair label="Plantings" of={(s) => String(s.plantings)} />
      </Panel>

      {/* What a farm runs decides what it sees — a section with nothing in it
          is a question mark rather than an answer. */}
      {now.byCrop.length === 0 ? null : (
        <Panel label="By crop">
          {now.byCrop.map((row) => {
            const last = before?.byCrop.find((c) => c.crop === row.crop);
            return (
              <View key={row.crop} style={styles.row}>
                <Text style={[styles.rowName, { color: colors.ink }]}>{row.crop}</Text>
                <View style={styles.rowValues}>
                  <Text style={[styles.now, { color: colors.ink }]}>
                    {row.massUg > 0 ? formatMass(row.massUg, units) : `${row.count}`}
                  </Text>
                  <Text style={[styles.before, { color: colors.muted }]}>
                    {last === undefined
                      ? before === null
                        ? ''
                        : 'not grown last year'
                      : `was ${last.massUg > 0 ? formatMass(last.massUg, units) : last.count}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </Panel>
      )}

      {now.byBed.length === 0 ? null : (
        <Panel label="By bed">
          {now.byBed.map((row) => {
            const last = before?.byBed.find((b) => b.bedId === row.bedId);
            return (
              <View key={row.bedId} style={styles.row}>
                <View style={styles.rowWords}>
                  <Text style={[styles.rowName, { color: colors.ink }]}>{row.bed}</Text>
                  {row.crops.length === 0 ? null : (
                    <Text style={[styles.rowCrops, { color: colors.muted }]}>
                      {row.crops.join(' · ')}
                    </Text>
                  )}
                </View>
                <View style={styles.rowValues}>
                  <Text style={[styles.now, { color: colors.ink }]}>
                    {row.massUg > 0 ? formatMass(row.massUg, units) : `${row.count}`}
                  </Text>
                  <Text style={[styles.before, { color: colors.muted }]}>
                    {last === undefined
                      ? ''
                      : `was ${last.massUg > 0 ? formatMass(last.massUg, units) : last.count}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </Panel>
      )}

      <Panel label="What this counts">
        <Body>
          Everything picked and recorded against a planting, by the season it was planted in. It
          does not know what any of it cost — that is a bigger question and a worse answer if it
          is half done.
        </Body>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE.md, minHeight: 34 },
  pairLabel: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.6, flex: 1 },
  pairValues: { alignItems: 'flex-end' },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE.md, minHeight: 38 },
  rowWords: { flex: 1, gap: 2 },
  rowName: { fontFamily: FONTS.body, fontSize: TYPE.body, flex: 1 },
  rowCrops: { fontFamily: FONTS.data, fontSize: TYPE.label - 1, letterSpacing: 0.4 },
  rowValues: { alignItems: 'flex-end' },
  now: { fontFamily: FONTS.data, fontSize: TYPE.body, letterSpacing: 0.4 },
  before: { fontFamily: FONTS.data, fontSize: TYPE.label - 1, letterSpacing: 0.4 },
});
