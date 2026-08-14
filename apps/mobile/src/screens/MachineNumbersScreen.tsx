import { Text, View } from 'react-native';
import { readFarmNumbers } from '@steading/core/read/farm-numbers';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useTheme } from '../theme/ThemeProvider';
import { styles } from './NumbersScreen';

/**
 * Hours on each machine, and what was serviced.
 *
 * ## Hours run is a difference, never a sum
 *
 * `hourReading.hours` is the **meter face** — the cumulative total on the
 * machine — so adding readings together would produce a number with no meaning
 * at all, and one that grew faster the more diligently somebody wrote readings
 * down. Punishing the careful farm is the wrong way round.
 *
 * What ran in a year is where the meter finished minus where it started, and
 * the baseline is the last reading *before* January when there is one, so hours
 * turned before the first entry of the year are counted rather than dropped.
 *
 * ## A machine with one reading shows nothing, and that is honest
 *
 * One reading in a year and none before it establishes no interval. It is left
 * off rather than shown as zero, because zero says "this did not run" and the
 * truth is "nobody wrote down enough to tell".
 */

export function MachineNumbersScreen(): React.ReactElement {
  const numbers = useLive(readFarmNumbers);
  const { colors } = useTheme();

  if (numbers === null) return <Loading title="Machines" />;

  const { now, before } = numbers;

  if (now.machines.machines === 0) return <Missing title="Machines" what="Any machines" />;

  const hours = (value: number): string =>
    value > 0 ? `${Math.round(value).toLocaleString()} h` : '—';

  return (
    <Screen title="Machines" subtitle={String(now.year)} back>
      <Panel label="This year">
        <View style={styles.pair}>
          <Text style={[styles.pairLabel, { color: colors.muted }]}>Hours run</Text>
          <View style={styles.pairValues}>
            <Text style={[styles.now, { color: colors.ink }]}>{hours(now.machines.hours)}</Text>
            <Text style={[styles.before, { color: colors.muted }]}>
              {before === null
                ? 'first year'
                : `${hours(before.machines.hours)} by now last year`}
            </Text>
          </View>
        </View>
        <View style={styles.pair}>
          <Text style={[styles.pairLabel, { color: colors.muted }]}>Services done</Text>
          <View style={styles.pairValues}>
            <Text style={[styles.now, { color: colors.ink }]}>{now.machines.services}</Text>
            <Text style={[styles.before, { color: colors.muted }]}>
              {before === null
                ? 'first year'
                : `${before.machines.services} by now last year`}
            </Text>
          </View>
        </View>
        <View style={styles.pair}>
          <Text style={[styles.pairLabel, { color: colors.muted }]}>Machines</Text>
          <View style={styles.pairValues}>
            <Text style={[styles.now, { color: colors.ink }]}>{now.machines.machines}</Text>
          </View>
        </View>
      </Panel>

      {now.machines.byMachine.length === 0 ? null : (
        <Panel label="By machine">
          {now.machines.byMachine.map((row) => {
            const last = before?.machines.byMachine.find((m) => m.machineId === row.machineId);
            return (
              <View key={row.machineId} style={styles.row}>
                <Text style={[styles.rowName, { color: colors.ink }]}>{row.machine}</Text>
                <View style={styles.rowValues}>
                  <Text style={[styles.now, { color: colors.ink }]}>{hours(row.hours)}</Text>
                  <Text style={[styles.before, { color: colors.muted }]}>
                    {last === undefined ? '' : `was ${hours(last.hours)}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </Panel>
      )}

      <Panel label="What this counts">
        <Body>
          Hours are the difference between meter readings, not the readings added up — so a machine
          needs at least two before it can say anything, and one whose meter was replaced starts
          again rather than counting backwards. Services are the ones marked done this year.
        </Body>
      </Panel>
    </Screen>
  );
}
