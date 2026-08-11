import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { newId } from '@steading/contracts';
import { listInventory, listMachines } from '@steading/core/read/iron';
import {
  Chip,
  Failure,
  Field,
  NumberField,
  Primary,
  Secondary,
  TextField,
  Toggle,
  useSaver,
} from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * A service schedule.
 *
 * **Dual-trigger: hours OR days, whichever comes round first.** At least one
 * has to be set or the schedule can never fire, which the contract enforces
 * and this screen refuses to submit rather than letting the server say no to
 * something that was avoidable here.
 *
 * A machine with no hour meter cannot carry an hours interval — `serviceDue`
 * returns nothing for that combination rather than a row that sits on Today
 * forever, so the control is not offered.
 *
 * Linking parts is what turns "change the filter" into "order the filter, then
 * change it": `partsDue` counts back from the service date by the lead time,
 * so the order lands before the deadline rather than on it.
 */

/**
 * The common jobs, and what somebody standing at the machine looks at while
 * doing each one (P15).
 *
 * The checks come with the preset for the same reason the intervals do: the
 * John Deere lesson in the competitive analysis is that a maintenance plan
 * nobody had to type in is a maintenance plan that gets used. A farm can add
 * its own lines below and take any of these off; what it should not have to do
 * is remember, from nothing, that an oil change is also when you look at the
 * plug washer.
 *
 * Short lines, in the order the machine is walked. These are prompts for
 * somebody who already knows the job, not instructions for somebody who does
 * not — an app that explained how to change oil would be read once and
 * resented twice.
 */
const PRESETS = [
  {
    title: 'Oil and filter',
    hours: 100,
    checks: ['Drain plug and washer', 'Filter seal seated', 'Level on the dipstick', 'Leaks underneath'],
  },
  { title: 'Air filter', hours: 250, checks: ['Element for holes', 'Housing seal', 'Dust valve clear'] },
  { title: 'Grease it', hours: 50, checks: ['Every nipple takes grease', 'Boots and seals intact'] },
  {
    title: 'Blades sharpened',
    days: 60,
    checks: ['Blade bolts torqued', 'Cracks at the mount', 'Balance after grinding', 'Deck clear underneath'],
  },
  {
    title: 'Winterise',
    days: 365,
    checks: ['Fuel stabilised or drained', 'Coolant strength', 'Battery off and charged', 'Grease bare metal'],
  },
] as const;

export function AddServiceScreen({ route }: ScreenProps<'AddService'>): React.ReactElement {
  const { machineId } = route.params;
  const log = useLog();
  const { colors } = useTheme();

  const machines = useLive(listMachines);
  const inventory = useLive(listInventory);
  const machine = machines?.find((m) => m.id === machineId) ?? null;

  const [title, setTitle] = useState('');
  const [byHours, setByHours] = useState(true);
  const [hours, setHours] = useState('100');
  const [byDays, setByDays] = useState(false);
  const [days, setDays] = useState('365');
  const [partIds, setPartIds] = useState<string[]>([]);
  const [checks, setChecks] = useState<string[]>([]);
  const [check, setCheck] = useState('');

  /** Twenty is the contract's cap; the control stops offering rather than failing at save. */
  const addCheck = useCallback(() => {
    const said = check.trim();
    if (said === '' || checks.length >= 20 || checks.includes(said)) return;
    setChecks((current) => [...current, said]);
    setCheck('');
  }, [check, checks]);

  const { saving, failure, save } = useSaver(useLeave());

  /**
   * A meterless machine cannot carry an hours interval, and the check has to
   * be here rather than only on the control.
   *
   * The hours toggle is not rendered when there is no meter — but its state
   * still defaults to on, and a hidden control with live state is exactly how
   * a pump ended up with a 100-hour oil change. `serviceDue` then returns null
   * for that combination, so the schedule would have been saved, listed, and
   * silently produce no row for the rest of its life. Worse than a wrong row:
   * a promise the app never keeps and never mentions.
   */
  const hasMeter = machine?.hasHourMeter ?? false;

  const intervalHours = hasMeter && byHours && Number(hours) > 0 ? Number(hours) : undefined;
  const intervalDays = byDays && Number(days) > 0 ? Math.round(Number(days)) : undefined;

  const commit = useCallback(() => {
    void save(async () => {
      await log({
        entity: 'maintenance',
        op: 'create',
        targetId: newId(),
        payload: {
          equipmentId: machineId,
          title: title.trim(),
          ...(intervalHours === undefined ? {} : { intervalHours }),
          ...(intervalDays === undefined ? {} : { intervalDays }),
          ...(partIds.length === 0 ? {} : { partIds }),
          ...(checks.length === 0 ? {} : { checks }),
        },
      });
    });
  }, [save, log, machineId, title, intervalHours, intervalDays, partIds, checks]);

  if (machines === null) return <Loading title="Service" />;
  if (machine === null) return <Missing title="Service" what="That machine" />;

  const parts = (inventory ?? []).filter(
    (item) => item.kind === 'part' && (item.equipmentId === undefined || item.equipmentId === machineId),
  );
  const noTrigger = intervalHours === undefined && intervalDays === undefined;

  return (
    <Screen title="Add a schedule" back>
      <Text style={[styles.label, { color: colors.muted }]}>{machine.name}</Text>

      <Field label="Common ones">
        <View style={styles.chips}>
          {PRESETS.filter((preset) => machine.hasHourMeter || !('hours' in preset)).map((preset) => (
            <Chip
              key={preset.title}
              label={preset.title}
              selected={title === preset.title}
              onPress={() => {
                setTitle(preset.title);
                // Replaces rather than appends: two presets tapped in a row
                // is somebody changing their mind, not building a longer list.
                setChecks([...preset.checks]);
                if ('hours' in preset) {
                  setByHours(true);
                  setHours(String(preset.hours));
                  setByDays(false);
                } else {
                  setByDays(true);
                  setDays(String(preset.days));
                  setByHours(false);
                }
              }}
            />
          ))}
        </View>
      </Field>

      <Field label="What is the job?">
        <TextField
          value={title}
          onChangeText={setTitle}
          placeholder="Oil and filter"
          maxLength={120}
          testID="service-title"
        />
      </Field>

      {machine.hasHourMeter ? (
        <>
          <Toggle label="Every so many hours" value={byHours} onChange={setByHours} />
          {byHours ? (
            <Field label="How many hours?">
              <NumberField value={hours} onChangeText={setHours} suffix="hours" accessibilityLabel="Hour interval" />
            </Field>
          ) : null}
        </>
      ) : (
        <Panel label="No meter">
          <Body>
            {machine.name} has no hour meter, so this schedule runs off dates. An hours interval
            on it would produce a row nothing could ever clear.
          </Body>
        </Panel>
      )}

      <Toggle label="Every so many days" value={byDays} onChange={setByDays} />
      {byDays ? (
        <Field label="How many days?">
          <NumberField value={days} onChangeText={setDays} suffix="days" accessibilityLabel="Day interval" />
        </Field>
      ) : null}

      {parts.length > 0 ? (
        <Field
          label="What does it use?"
          hint="Linked parts get their own row on Today, dated early enough to order them."
        >
          <View style={styles.chips}>
            {parts.map((part) => (
              <Chip
                key={part.id}
                label={`${part.name} (${part.quantity})`}
                selected={partIds.includes(part.id)}
                onPress={() =>
                  setPartIds((current) =>
                    current.includes(part.id)
                      ? current.filter((id) => id !== part.id)
                      : [...current, part.id],
                  )
                }
              />
            ))}
          </View>
        </Field>
      ) : null}

      {/**
        * The walkaround (P15).
        *
        * Tapping a line removes it, which is why they are chips rather than
        * rows: the list arrives from the preset nearly right, and the work is
        * taking off the two that do not apply to this machine.
        */}
      <Field
        label="What do you look at?"
        hint="Shown as a list when you record the job. Anything not right becomes a job of its own."
      >
        {checks.length === 0 ? null : (
          <View style={styles.chips}>
            {checks.map((line) => (
              <Chip
                key={line}
                label={line}
                selected
                onPress={() => setChecks((current) => current.filter((c) => c !== line))}
              />
            ))}
          </View>
        )}
        {checks.length >= 20 ? null : (
          <>
            <TextField
              value={check}
              onChangeText={setCheck}
              placeholder="Coolant level"
              maxLength={80}
              testID="service-check"
            />
            <Secondary label="Add that check" onPress={addCheck} testID="add-check" />
          </>
        )}
      </Field>

      {noTrigger ? (
        <Panel>
          <Body>
            A schedule needs an hour interval, a day interval, or both — otherwise there is
            nothing for it to come round on.
          </Body>
        </Panel>
      ) : null}

      <Failure message={failure} />

      <Primary
        label="Add the schedule"
        disabled={saving || title.trim() === '' || noTrigger}
        onPress={commit}
        testID="save-service"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
