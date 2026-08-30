import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { listInventory, listMachines, type Machine, runningLow } from '@homefarm/core/read/iron';
import { Primary, Row } from '../components/Form';
import { Grid } from '../components/Grid';
import { Icon } from '../components/Icon';
import { ArchCard, Body, Panel } from '../components/Panel';
import { PaneTitle, Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useTheme } from '../theme/ThemeProvider';
import { useNav } from '../hooks/useNav';
import { useWindow } from '../hooks/useWindow';
import { MachineBody } from './MachineScreen';
import { FONTS, LAYOUT, SPACE, TYPE } from '../theme/tokens';

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
  const nav = useNav();
  const { panes } = useWindow();

  const machines = useLive(listMachines);
  const inventory = useLive(listInventory);
  const [chosen, setChosen] = useState<string | null>(null);

  // `wide` while it reads, because the hub it becomes is wide and the hero
  // sits inside that cap — see `Loading`.
  if (machines === null) return <Screen title="Iron" back wide>{null}</Screen>;

  const low = runningLow(inventory ?? []);

  /**
   * List-detail, on the same terms History set.
   *
   * The machine opens **beside** the list instead of over it, and the pushed
   * route is untouched — a narrow window still navigates, so nothing about
   * this screen changes on a phone. `MachineScreen` was split by taking its
   * `<Screen>` wrapper off rather than by writing a second detail view, so the
   * pane and the pushed screen are the same component and cannot disagree.
   *
   * The first machine selects itself. A detail pane that opens empty is half a
   * screen of nothing, and this list is ordered so the first row is the one
   * most likely to be wanted.
   */
  const split = panes === 2 && machines.length > 0;
  const open = split ? (machines.find((m) => m.id === chosen) ?? machines[0] ?? null) : null;

  return (
    <Screen
      title="Iron"
      back
      wide
      {...(open === null
        ? {}
        : {
            aside: (
              <>
                <PaneTitle>{open.name}</PaneTitle>
                <MachineBody machine={open} />
              </>
            ),
          })}
    >
      {machines.length === 0 ? (
        <Panel label="No equipment yet">
          {/* Empty screens invite (UX-SPEC §6). */}
          <Body>Add your tractor and its service schedule comes with it.</Body>
        </Panel>
      ) : (
        <Grid cell={LAYOUT.column / 2} testID="iron-grid">
          {machines.map((machine) => (
            <MachineCard
              key={machine.id}
              machine={machine}
              // Beside a pane a row selects; without one it navigates. The
              // pushed route is still the only way in on a phone.
              onPress={() =>
                split
                  ? setChosen(machine.id)
                  : nav.navigate('Machine', { machineId: machine.id })
              }
            />
          ))}
        </Grid>
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
    <ArchCard onPress={onPress} testID={`machine-${machine.id}`}>
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

      {/**
        * The mark, without the word.
        *
        * Every card said "OPEN ›" although the whole card is the button and,
        * since the motif was spent, wears a door that says so. Six of them
        * down a column is the repetition R3's affordance work exists to
        * remove: a chevron already promises "goes somewhere else", and the
        * word beside it promises it twice.
        *
        * Kept at the foot rather than moved into the head, because the head is
        * a name against a figure at display size and a third thing in that row
        * would crowd the number the eye is there to compare.
        */}
      <View style={styles.more}>
        <Icon name="forward" size={20} color={colors.lanternInk} />
      </View>
    </ArchCard>
  );
}

const styles = StyleSheet.create({
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
  // Sits on the bottom edge of a stretched card rather than floating mid-air
  // with the slack under it. No free space, no effect — so a phone is unmoved.
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    alignSelf: 'flex-end',
    marginTop: 'auto',
  },
});
