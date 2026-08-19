import { Text, View } from 'react-native';
import { formatMass } from '@homefarm/contracts';
import { readFarmNumbers } from '@homefarm/core/read/farm-numbers';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useUnits } from '../hooks/useUnits';
import { useTheme } from '../theme/ThemeProvider';
import { styles } from './NumbersScreen';

/**
 * What the animals gave, and what was lost.
 *
 * ## Head is not a yearly figure, and says so
 *
 * Everything else here is "in this year": eggs collected, milk taken, deaths
 * recorded. **How many head there are is not** — a farm has what it has, and
 * asking "how many hens in 2025" of a live flock is a question the records
 * cannot answer without a history of every arrival and departure. So it is
 * shown once, plainly, without a column beside it pretending otherwise.
 *
 * ## Produce is never added across kinds
 *
 * Millilitres of milk and grams of fibre are different quantities, and one
 * total across them would be arithmetic on a category error. Each kind keeps
 * its own row and its own unit.
 *
 * ## Losses are counted and not softened
 *
 * A farm that loses birds to a fox needs the number, and a screen that rounds
 * it away or buries it under a euphemism is a screen nobody trusts with the
 * rest. It sits with the good news because it is part of the same year.
 */

export function AnimalNumbersScreen(): React.ReactElement {
  const numbers = useLive(readFarmNumbers);
  const units = useUnits();
  const { colors } = useTheme();

  if (numbers === null) return <Loading title="Animals" />;

  const { now, before } = numbers;

  if (now.animals.head === 0 && now.animals.eggs === 0 && before === null) {
    return <Missing title="Animals" what="Any stock" />;
  }

  const pair = (label: string, value: string, last: string | null): React.ReactElement => (
    <View key={label} style={styles.pair}>
      <Text style={[styles.pairLabel, { color: colors.muted }]}>{label}</Text>
      <View style={styles.pairValues}>
        <Text style={[styles.now, { color: colors.ink }]}>{value}</Text>
        {last === null ? null : (
          <Text style={[styles.before, { color: colors.muted }]}>{last}</Text>
        )}
      </View>
    </View>
  );

  const was = (value: string): string | null =>
    before === null ? 'first year' : `${value} by now last year`;

  const count = (value: number): string => (value > 0 ? value.toLocaleString() : '—');

  return (
    <Screen title="Animals" subtitle={String(now.year)} back>
      <Panel label="On the farm now">
        {/* No second column, deliberately — see the header. */}
        {pair('Head', count(now.animals.head), null)}
        {pair('Groups', count(now.animals.groups), null)}
      </Panel>

      <Panel label="What they gave">
        {pair('Eggs', count(now.animals.eggs), was(count(before?.animals.eggs ?? 0)))}
        {now.animals.produce.map((row) => {
          const last = before?.animals.produce.find(
            (other) =>
              other.kind === row.kind && other.label === row.label && other.unit === row.unit,
          );
          return pair(
            row.label,
            `${row.amount.toLocaleString()} ${row.unit}`,
            before === null
              ? 'first year'
              : last === undefined
                ? 'none last year'
                : `${last.amount.toLocaleString()} ${last.unit} by now last year`,
          );
        })}
      </Panel>

      <Panel label="Feed">
        {pair(
          'Fed out',
          now.feed.massUg > 0 ? formatMass(now.feed.massUg, units) : '—',
          was(before !== null && before.feed.massUg > 0 ? formatMass(before.feed.massUg, units) : '—'),
        )}
        {pair('Times fed', count(now.feed.feeds), was(count(before?.feed.feeds ?? 0)))}
      </Panel>

      {now.animals.losses === 0 && (before?.animals.losses ?? 0) === 0 ? null : (
        <Panel label="Lost">
          {pair('This year', count(now.animals.losses), was(count(before?.animals.losses ?? 0)))}
          {now.animals.byCause.map((row) => (
            <View key={row.cause} style={styles.row}>
              <Text style={[styles.rowName, { color: colors.ink }]}>{row.cause}</Text>
              <Text style={[styles.now, { color: colors.ink }]}>{row.count}</Text>
            </View>
          ))}
        </Panel>
      )}

      <Panel label="What this counts">
        <Body>
          Everything logged against a group or an animal, by the year it happened in. Head and
          groups are what is here now rather than a figure for the year — the records say what
          arrived and what was lost, not what the flock was on any given morning.
        </Body>
      </Panel>
    </Screen>
  );
}
