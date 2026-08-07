import { StyleSheet, Text, View } from 'react-native';
import { listInventory, listMachines, type Machine, runningLow } from '@steading/core/read/iron';
import { Primary, Row } from '../components/Form';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * Iron — equipment and machines.
 *
 * Deliberately the same shape as Stock: a list, a card that opens, a secondary
 * add. The morning list does not sort itself by module — "feed birds, check
 * waterer, grease loader" — so the two halves of the app must not feel like
 * two apps.
 *
 * The shelf sits here because a part is only ever thought about beside the
 * machine it belongs to — but this is no longer the ONLY door to it, and that
 * was a real defect. Iron is hidden for a farm that runs no equipment, so a
 * poultry keeper with no tractor could not reach their feed: three of the
 * shelf's five kinds are feed, bedding and medicine, none of which is
 * machinery. It is on the Farm hub as well now.
 */
export function IronScreen(): React.ReactElement {
  const { colors } = useTheme();
  const nav = useNav();

  const machines = useLive(listMachines);
  const inventory = useLive(listInventory);

  if (machines === null) return <Screen title="Iron" back>{null}</Screen>;

  const low = runningLow(inventory ?? []);

  return (
    <Screen title="Iron" back>
      {machines.length === 0 ? (
        <Panel label="No equipment yet">
          <View style={styles.spot}>
            <Icon name="bench" size={56} color={colors.muted} />
          </View>
          {/* Empty screens invite (UX-SPEC §6). */}
          <Body>Add your tractor and its service schedule comes with it.</Body>
        </Panel>
      ) : (
        machines.map((machine) => (
          <MachineCard
            key={machine.id}
            machine={machine}
            onPress={() => nav.navigate('Machine', { machineId: machine.id })}
          />
        ))
      )}

      <Primary
        label={machines.length === 0 ? 'Add a machine' : 'Add another machine'}
        onPress={() => nav.navigate('AddMachine')}
        testID="add-machine"
      />

      <Row
        title="The shelf"
        detail={
          low.length > 0
            ? `Running low: ${low.map((item) => item.name).join(', ')}`
            : 'Feed, bedding, medicine and parts'
        }
        icon="parts"
        testID="go-inventory"
        onPress={() => nav.navigate('Inventory')}
      />
    </Screen>
  );
}

function MachineCard({
  machine,
  onPress,
}: {
  machine: Machine;
  onPress: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const description = [machine.make, machine.model].filter(Boolean).join(' ');

  return (
    <Touch affordance="chevron"
      onPress={onPress}
      accessibilityRole="button"
      testID={`machine-${machine.id}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.raised, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={styles.head}>
        <View style={styles.name}>
          <Text style={[styles.machineName, { color: colors.ink }]}>{machine.name}</Text>
          {description ? (
            <Text style={[styles.label, { color: colors.muted }]}>{description}</Text>
          ) : null}
        </View>

        {machine.hours !== null ? (
          <View style={styles.meter}>
            <Text style={[styles.meterValue, { color: colors.ink }]}>{machine.hours}</Text>
            <Text style={[styles.label, { color: colors.muted }]}>hours</Text>
          </View>
        ) : null}
      </View>

      {/**
       * W5 — the number that lets a filter be ordered before it matters.
       *
       * Everyone else alerts when you cross 250 hours. "About 1.4 h/day" is
       * the figure that turns a threshold into a date, and it is null until
       * there are two readings rather than being guessed from one.
       */}
      {machine.usagePerDay !== null ? (
        <Text style={[styles.usage, { color: colors.muted }]}>
          About {machine.usagePerDay.toFixed(1)} hours a day
        </Text>
      ) : null}

      {machine.hasHourMeter ? null : (
        <Text style={[styles.usage, { color: colors.muted }]}>
          No hour meter — services run off dates.
        </Text>
      )}

      <View style={styles.more}>
        <Text style={[styles.label, { color: colors.lanternInk }]}>Open</Text>
        <Icon name="forward" size={20} color={colors.lanternInk} />
      </View>
    </Touch>
  );
}

const styles = StyleSheet.create({
  spot: { alignItems: 'center', paddingVertical: SPACE.md },
  card: {
    padding: SPACE.lg,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    gap: SPACE.sm,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  name: { flex: 1, gap: 2 },
  meter: { alignItems: 'flex-end' },
  machineName: { fontFamily: FONTS.display, fontSize: TYPE.title },
  meterValue: { fontFamily: FONTS.display, fontSize: TYPE.title, fontVariant: ['tabular-nums'] },
  usage: { fontFamily: FONTS.body, fontSize: TYPE.body },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  more: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, alignSelf: 'flex-end' },
});
