import { StyleSheet, Text, View } from 'react-native';
import { formatMass } from '@homefarm/contracts';
import { readFarmNumbers, type YearNumbers } from '@homefarm/core/read/farm-numbers';
import { Row } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useUnits } from '../hooks/useUnits';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * What the farm did this year, beside what it did last year.
 *
 * ## The whole farm, which it was not
 *
 * This screen was about crops. Reported plainly: *"The Numbers on the farm
 * screen should show ALL data, products, feed, crops etc. not just plants."*
 *
 * That is right, and it was the row's own fault for being called what it is. A
 * page reached from the Farm hub under "The numbers" promises the farm, and a
 * farm keeping hens and a tractor opened it to read about beds.
 *
 * ## One overview, three ways down
 *
 * *"1 main screen with a good overview and individual screens for crop,
 * animals, Machines."* So this is the overview and nothing else: the figures
 * somebody wants at a glance, each beside the same figure a year ago, and three
 * rows to the detail. Everything that used to be here about crops is on the
 * crop screen, unchanged.
 *
 * ## Two columns, and that is still the whole design
 *
 * The single thing this app has that a notebook does not is the previous year
 * sitting next to this one. Nothing here is a lone number. Where there is no
 * pair — a farm's first year — it says so rather than printing a dash and
 * letting somebody wonder whether that is a zero.
 *
 * ## R2, and why this is not the home screen
 *
 * *"Home is today, not a dashboard. Charts live one level down."* This is one
 * level down: a row in the Farm hub, reached deliberately, never in the way of
 * a morning.
 *
 * ## Yield, not money
 *
 * Cost data exists and is deliberately absent. What came off and what it cost
 * is a larger question needing feed apportioned between groups, a position on
 * unpaid labour and an opinion about whether a barn is a cost — and half of
 * that answered badly is worse than none of it.
 */

export function NumbersScreen(): React.ReactElement {
  const numbers = useLive(readFarmNumbers);
  const nav = useNav();
  const units = useUnits();
  const { colors } = useTheme();

  // `wide`, because that is what it becomes — see `Loading`.
  if (numbers === null) return <Loading title="The numbers" wide />;

  const { now, before } = numbers;

  /**
   * Nothing anywhere, which is a different screen from a quiet year.
   *
   * Checked across every domain rather than plantings alone — a farm with forty
   * hens and no beds is not an empty farm, and telling it so on the screen
   * meant to show it its own year would be the app not looking.
   */
  const anything =
    now.crops.plantings > 0 ||
    now.animals.head > 0 ||
    now.animals.eggs > 0 ||
    now.feed.feeds > 0 ||
    now.machines.machines > 0;

  if (!anything && before === null) {
    return <Missing title="The numbers" what="Anything to count yet" />;
  }

  /** A figure and the same figure a year ago, which is the only useful shape. */
  const Pair = ({
    label,
    of,
  }: {
    label: string;
    of: (year: YearNumbers) => string;
  }): React.ReactElement => (
    <View style={styles.pair}>
      <Text style={[styles.pairLabel, { color: colors.muted }]}>{label}</Text>
      <View style={styles.pairValues}>
        <Text style={[styles.now, { color: colors.ink }]}>{of(now)}</Text>
        <Text style={[styles.before, { color: colors.muted }]}>
          {before === null ? 'first year' : `${of(before)} by now last year`}
        </Text>
      </View>
    </View>
  );

  const count = (value: number): string => (value > 0 ? value.toLocaleString() : '—');
  const mass = (value: number): string => (value > 0 ? formatMass(value, units) : '—');
  const hours = (value: number): string =>
    value > 0 ? `${Math.round(value).toLocaleString()} h` : '—';

  return (
    <Screen title="The numbers" subtitle={String(now.year)} back wide>
      {/* What a farm runs decides what it sees (§4). A section with nothing in
          it is a question mark rather than an answer, so each of these appears
          only once there is something to put in it — and each stays once there
          is, including a year where the figure went back to nothing. */}
      {now.animals.head === 0 && before?.animals.eggs === undefined ? null : (
        <Panel label="From the animals">
          <Pair label="Eggs" of={(y) => count(y.animals.eggs)} />
          {now.animals.produce.length === 0 && (before?.animals.produce.length ?? 0) === 0
            ? null
            : now.animals.produce.map((row) => (
                <Pair
                  key={`${row.kind}:${row.label}:${row.unit}`}
                  label={row.label}
                  of={(y) =>
                    // Matched by the same key on both sides, so last year's
                    // milk lands under milk rather than under whatever came
                    // first — and a kind grown into this year shows a dash
                    // against last year rather than borrowing its neighbour.
                    count(
                      y.animals.produce.find(
                        (other) =>
                          other.kind === row.kind &&
                          other.label === row.label &&
                          other.unit === row.unit,
                      )?.amount ?? 0,
                    ) + (row.unit === 'ml' ? ' ml' : ' g')
                  }
                />
              ))}
          <Pair label="Lost" of={(y) => count(y.animals.losses)} />
        </Panel>
      )}

      {now.feed.feeds === 0 && (before?.feed.feeds ?? 0) === 0 ? null : (
        <Panel label="Feed">
          <Pair label="Fed out" of={(y) => mass(y.feed.massUg)} />
          <Pair label="Times fed" of={(y) => count(y.feed.feeds)} />
        </Panel>
      )}

      {now.crops.plantings === 0 && (before?.crops.plantings ?? 0) === 0 ? null : (
        <Panel label="From the ground">
          <Pair label="Picked, by weight" of={(y) => mass(y.crops.massUg)} />
          <Pair label="Picked, by the piece" of={(y) => count(y.crops.count)} />
          <Pair label="Plantings" of={(y) => count(y.crops.plantings)} />
        </Panel>
      )}

      {now.machines.machines === 0 ? null : (
        <Panel label="Iron">
          <Pair label="Hours run" of={(y) => hours(y.machines.hours)} />
          <Pair label="Services done" of={(y) => count(y.machines.services)} />
        </Panel>
      )}

      {/* One level further down, per domain. Only where there is something to
          look at — a row leading to an empty page is a wasted press. */}
      <View style={styles.rows}>
        {now.crops.plantings === 0 ? null : (
          <Row
            title="Crops"
            detail="By crop and by bed"
            testID="numbers-crops"
            onPress={() => nav.navigate('CropNumbers')}
          />
        )}
        {now.animals.head === 0 && now.animals.eggs === 0 ? null : (
          <Row
            title="Animals"
            detail="What they gave, and what was lost"
            testID="numbers-animals"
            onPress={() => nav.navigate('AnimalNumbers')}
          />
        )}
        {now.machines.machines === 0 ? null : (
          <Row
            title="Machines"
            detail="Hours on each, and what was serviced"
            testID="numbers-machines"
            onPress={() => nav.navigate('MachineNumbers')}
          />
        )}
      </View>

      <Panel label="What this counts">
        <Body>
          Everything recorded against this farm, by the year it happened in. It does not know what
          any of it cost — that is a bigger question and a worse answer if it is half done.
        </Body>
      </Panel>
    </Screen>
  );
}

export const styles = StyleSheet.create({
  rows: { gap: SPACE.sm },
  pair: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACE.md,
    minHeight: 34,
  },
  pairLabel: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.6, flex: 1 },
  pairValues: { alignItems: 'flex-end' },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACE.md,
    minHeight: 38,
  },
  rowWords: { flex: 1, gap: 2 },
  rowName: { fontFamily: FONTS.body, fontSize: TYPE.body, flex: 1 },
  rowCrops: { fontFamily: FONTS.data, fontSize: TYPE.label - 1, letterSpacing: 0.4 },
  rowValues: { alignItems: 'flex-end' },
  now: { fontFamily: FONTS.data, fontSize: TYPE.body, letterSpacing: 0.4 },
  before: { fontFamily: FONTS.data, fontSize: TYPE.label - 1, letterSpacing: 0.4 },
});
