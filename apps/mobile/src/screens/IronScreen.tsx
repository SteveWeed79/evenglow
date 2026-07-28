import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { newId } from '@steading/contracts';
import { listMachines, type Machine } from '@steading/core/read/iron';
import { describeLogFailure } from '@steading/core/sync/failure';
import { subscribe } from '@steading/core/sync/engine';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Tally } from '../components/Tally';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * Iron — equipment and machines.
 *
 * Deliberately the same shape as Stock: a list, a primary log action per item,
 * a secondary add. The morning list does not sort itself by module — "feed
 * birds, check waterer, grease loader" — so the two halves of the app must not
 * feel like two apps.
 */
export function IronScreen(): React.ReactElement {
  const { colors } = useTheme();
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState<Machine | null>(null);

  const refresh = useCallback(async () => {
    setMachines(await listMachines());
  }, []);

  useEffect(() => subscribe(() => void refresh()), [refresh]);

  if (adding) return <AddMachineScreen onDone={() => setAdding(false)} />;
  if (logging) return <LogHoursScreen machine={logging} onDone={() => setLogging(null)} />;
  if (machines === null) return <Screen title="Iron">{null}</Screen>;

  return (
    <Screen title="Iron">
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
          <MachineCard key={machine.id} machine={machine} onLogHours={() => setLogging(machine)} />
        ))
      )}

      <Pressable
        onPress={() => setAdding(true)}
        accessibilityRole="button"
        testID="add-machine"
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: colors.lantern, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={styles.primaryLabel}>
          {machines.length === 0 ? 'Add a machine' : 'Add another machine'}
        </Text>
      </Pressable>
    </Screen>
  );
}

function MachineCard({
  machine,
  onLogHours,
}: {
  machine: Machine;
  onLogHours: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const description = [machine.make, machine.model].filter(Boolean).join(' ');

  return (
    <View style={[styles.card, { backgroundColor: colors.raised, borderColor: colors.border }]}>
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

      {machine.hasHourMeter ? (
        <Pressable
          onPress={onLogHours}
          accessibilityRole="button"
          testID={`log-hours-${machine.id}`}
          style={({ pressed }) => [
            styles.action,
            { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Icon name="hour-meter" size={20} color={colors.ink} />
          <Text style={[styles.actionLabel, { color: colors.ink }]}>Log hours</Text>
        </Pressable>
      ) : (
        <Text style={[styles.usage, { color: colors.muted }]}>
          No hour meter — services run off dates.
        </Text>
      )}
    </View>
  );
}

function AddMachineScreen({ onDone }: { onDone: () => void }) {
  const log = useLog();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [make, setMake] = useState('');
  const [hasHourMeter, setHasHourMeter] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (saving || name.trim() === '') return;
    setSaving(true);
    try {
      await log({
        entity: 'equipment',
        op: 'create',
        targetId: newId(),
        payload: {
          name: name.trim(),
          hasHourMeter,
          ...(make.trim() === '' ? {} : { make: make.trim() }),
        },
      });
    } catch (error) {
      setSaving(false);
      setFailure(describeLogFailure(error));
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDone();
  }, [saving, name, log, hasHourMeter, make, onDone]);

  return (
    <Screen title="Add a machine" back>
      <Text style={[styles.label, { color: colors.muted }]}>What is it?</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="The tractor, the mower, the pump"
        placeholderTextColor={colors.muted}
        maxLength={80}
        style={[styles.field, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.ink }]}
      />

      <Text style={[styles.label, { color: colors.muted }]}>Make and model (optional)</Text>
      <TextInput
        value={make}
        onChangeText={setMake}
        placeholder="Kubota L2501"
        placeholderTextColor={colors.muted}
        maxLength={80}
        style={[styles.field, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.ink }]}
      />

      <Pressable
        onPress={() => {
          void Haptics.selectionAsync();
          setHasHourMeter((h) => !h);
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: hasHourMeter }}
        style={({ pressed }) => [
          styles.toggle,
          {
            backgroundColor: hasHourMeter ? colors.lantern : colors.raised,
            borderColor: hasHourMeter ? colors.lanternInk : colors.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <Text style={[styles.toggleLabel, { color: hasHourMeter ? '#241c14' : colors.ink }]}>
          {/* Pumps and augers have no meter, and their services run off dates.
              Assuming one would put a row on Today nothing can ever clear. */}
          It has an hour meter
        </Text>
      </Pressable>

      {failure ? (
        <Panel>
          <Body>{failure}</Body>
        </Panel>
      ) : null}

      <Pressable
        onPress={() => void save()}
        disabled={saving || name.trim() === ''}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.primary,
          {
            backgroundColor: colors.lantern,
            opacity: saving || name.trim() === '' ? 0.4 : pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text style={styles.primaryLabel}>Add machine</Text>
      </Pressable>
    </Screen>
  );
}

/**
 * Logging an hour meter.
 *
 * The Tally again, and the reuse is the point: an hour reading is entered the
 * same way an egg count is, by someone standing beside the machine with the
 * same gloves on. Different steps, because a meter moves in single hours and a
 * basket moves in dozens.
 */
function LogHoursScreen({ machine, onDone }: { machine: Machine; onDone: () => void }) {
  const log = useLog();

  const commit = useCallback(
    async (hours: number) => {
      await log({
        entity: 'hourReading',
        op: 'create',
        payload: { occurredAt: Date.now(), equipmentId: machine.id, hours },
      });
      onDone();
    },
    [log, machine.id, onDone],
  );

  return (
    <Screen title={machine.name} back>
      <Panel label="Reading">
        <Body>
          Type what the meter says now, not the hours since last time. The app works out the
          difference, and a reading lower than the last one is refused by the server rather
          than quietly accepted.
        </Body>
      </Panel>

      <Tally
        label={`Hour meter on ${machine.name}`}
        unit="hours"
        // Tens and hundreds: a meter reads 1,247, and starting from zero in
        // single taps would be absurd. The 100 step is what makes this usable.
        steps={[1, 10, 100]}
        onCommit={(value) => commit(value)}
      />
    </Screen>
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
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: SPACE.xs,
  },
  actionLabel: { fontFamily: FONTS.body, fontSize: TYPE.body },
  field: {
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACE.lg,
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
  },
  toggle: {
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
  },
  toggleLabel: { fontFamily: FONTS.body, fontSize: TYPE.body },
  primary: {
    minHeight: TAP.primary,
    borderRadius: RADII.softHead,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACE.sm,
  },
  primaryLabel: { fontFamily: FONTS.display, fontSize: TYPE.lede, color: '#241c14' },
});
