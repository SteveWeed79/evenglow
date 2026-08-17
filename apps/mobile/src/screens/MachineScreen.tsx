import { StyleSheet, Text, View } from 'react-native';
import { listInventory, listMachines, listServices, type Machine } from '@steading/core/read/iron';
import { partsNote } from '@steading/contracts';
import { Primary, Row } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Notes } from '../components/Notes';
import { Photos } from '../components/Photos';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Coming } from '../components/Coming';
import { Timeline } from '../components/Timeline';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * One machine, its meter and its service schedules.
 *
 * W5 is the argument for this screen: everyone else alerts when you cross 250
 * hours, and the number worth having is "due in about nine days at 1.4 h/day"
 * because that is the one that lets a filter be ordered before it matters.
 * That arithmetic existed in `serviceDue` and `projectReading` and had no
 * maintenance record to run against — a farm could log hours forever and never
 * be told anything.
 */
export function MachineScreen({ route }: ScreenProps<'Machine'>): React.ReactElement {
  const { machineId } = route.params;

  const machines = useLive(listMachines);
  const machine = machines?.find((m) => m.id === machineId) ?? null;

  if (machines === null) return <Loading title="Iron" />;
  if (machine === null) return <Missing title="Iron" what="That machine" />;

  return (
    <Screen title={machine.name} back>
      <MachineBody machine={machine} />
    </Screen>
  );
}

/**
 * Everything about one machine, without a screen around it.
 *
 * Split out so the Iron hub can render it in a supporting pane beside the
 * list, which is the list-detail arrangement `docs/LANDSCAPE-PLAN.md` asks for
 * — and split by **taking the wrapper off** rather than by writing a second
 * version, so the pane and the pushed screen cannot drift. There is one
 * machine detail in this app and it is here.
 *
 * It takes the record rather than an id. The hub has already loaded the list
 * it selected from and the screen has already loaded it to title itself with,
 * so asking for it again would be a second subscription to the same rows for
 * no gain — and it is what lets the guards above stay where the screen can
 * answer them with a whole `Missing` rather than a panel in half a layout.
 */
export function MachineBody({ machine }: { machine: Machine }): React.ReactElement {
  const machineId = machine.id;
  const nav = useNav();
  const { colors } = useTheme();

  const services = useLive(listServices);
  const inventory = useLive(listInventory);

  const mine = (services ?? []).filter((s) => s.equipmentId === machineId);
  const description = [machine.make, machine.model].filter(Boolean).join(' ');
  const partsById = new Map((inventory ?? []).map((item) => [item.id, item]));

  return (
    <>
      {description ? (
        <Text style={[styles.label, { color: colors.muted }]}>{description}</Text>
      ) : null}

      <Panel label="The meter">
        {machine.hasHourMeter ? (
          <>
            <View style={styles.reading}>
              <Text style={[styles.hours, { color: colors.ink }]}>{machine.hours ?? '—'}</Text>
              <Text style={[styles.label, { color: colors.muted }]}>hours</Text>
            </View>
            {/**
             * Null until there are two readings, and shown as null rather than
             * guessed. A rate from one reading is a line through a single
             * point, and a projection built on it would put a date on Today
             * that nothing can be trusted to mean.
             */}
            <Body>
              {machine.usagePerDay === null
                ? 'Log the meter twice and this starts telling you when services will land, in days rather than in hours.'
                : `About ${machine.usagePerDay.toFixed(1)} hours a day.`}
            </Body>
          </>
        ) : (
          <Body>No hour meter — services on this one run off dates.</Body>
        )}
      </Panel>

      {machine.hasHourMeter ? (
        <Primary
          label="Log the hours"
          onPress={() => nav.navigate('LogHours', { machineId })}
          testID="go-hours"
        />
      ) : null}

      {mine.length === 0 ? (
        <Panel label="No schedule yet">
          <Body>
            Add what this needs and when — every 100 hours, every spring — and it arrives on
            Today by itself, three weeks ahead so the filter can be ordered.
          </Body>
        </Panel>
      ) : (
        mine.map((service) => {
          const parts = (service.partIds ?? [])
            .flatMap((id) => {
              const item = partsById.get(id);
              return item === undefined ? [] : [{ id, name: item.name, quantity: item.quantity }];
            });
          const short = partsNote(parts);

          return (
            <Row
              key={service.id}
              title={service.title}
              detail={[
                service.intervalHours === undefined ? null : `every ${service.intervalHours} h`,
                service.intervalDays === undefined ? null : `every ${service.intervalDays} days`,
                short,
              ]
                .filter((part): part is string => part !== null)
                .join(' · ')}
              onPress={() => nav.navigate('ServiceDone', { serviceId: service.id })}
            />
          );
        })
      )}

      <Notes subjectEntity="equipment" subjectId={machineId} subject={machine.name} />

      {/* Receipts and manuals: the history handed over with the machine, and
          the half of P6 with a clear buyer. */}
      <Photos subjectId={machineId} what={machine.name} />

      <Primary
        label={mine.length === 0 ? 'Add a service schedule' : 'Add another schedule'}
        onPress={() => nav.navigate('AddService', { machineId })}
        testID="add-service"
      />

      <Panel label="This machine">
        <Row
          title={`Change ${machine.name}`}
          detail="Its make, model, serial, year and meter"
          testID="go-edit-machine"
          onPress={() => nav.navigate('EditMachine', { machineId })}
        />
      </Panel>

      {/* The readings and the services, in the order they happened. This is
          most of what P7 means by the history you hand over with a tractor,
          and the machine screen was the one place it could not be seen. */}
      <Coming subject={machineId} here="Machine" />
      <Timeline subject={machineId} />
    </>
  );
}

const styles = StyleSheet.create({
  reading: { flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm },
  hours: { fontFamily: FONTS.display, fontSize: TYPE.hero, fontVariant: ['tabular-nums'] },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
