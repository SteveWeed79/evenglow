import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { listInventory, listMachines, listServices } from '@steading/core/read/iron';
import { newId, partsNote } from '@steading/contracts';
import { Confirm, Failure, Field, NumberField, Primary, Toggle, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, TYPE } from '../theme/tokens';

/**
 * Recording that a service was done.
 *
 * This is the other half of the schedule and the reason `lastDoneAtHours` and
 * `lastDoneAtDate` exist on the entity. Until it was reachable, a service
 * interval counted from zero forever: a tractor bought at 900 hours with a
 * 250-hour interval read as overdue in perpetuity, which is honest the first
 * morning and noise by the third.
 *
 * The meter reading is asked for rather than taken from the last hour log,
 * because the two are minutes apart on the day of a service and the interval
 * has to count from the reading the work was actually done at.
 */
export function ServiceDoneScreen({ route }: ScreenProps<'ServiceDone'>): React.ReactElement {
  const { serviceId } = route.params;
  const log = useLog();
  const { colors } = useTheme();

  const services = useLive(listServices);
  const machines = useLive(listMachines);
  const inventory = useLive(listInventory);

  const service = services?.find((s) => s.id === serviceId) ?? null;
  const machine = machines?.find((m) => m.id === service?.equipmentId) ?? null;

  const [atHours, setAtHours] = useState('');

  /**
   * The checks that were **not** right, which is the short list on any
   * ordinary day.
   *
   * Ticking what passed would be eight taps to say nothing happened, every
   * time, and a control that costs eight taps to report "fine" is one people
   * stop using and then stop reading. The record that the walkaround happened
   * at all is the service itself — `lastDoneAtDate` — so nothing here needs
   * to prove a clean pass.
   */
  const [wrong, setWrong] = useState<string[]>([]);

  const { saving, failure, save } = useSaver(useLeave());
  const removed = useSaver(useLeave());

  const commit = useCallback(() => {
    if (service === null) return;

    /**
     * An untouched field means "the reading on the screen", not "no reading".
     *
     * **This is the bug that made the button look broken.** Reported as *"I
     * have it done, does nothing, it doesn't clear the task"* — from a tractor
     * showing 110 hours, on a schedule that runs every 100.
     *
     * The meter box shows the machine's current reading as a PLACEHOLDER, so
     * it is grey text in an empty field. Tapping straight through it — which
     * is the whole design of this screen, since the reading is nearly always
     * the one already on file — left `atHours` as `''`. That is not a finite
     * positive number, so `lastDoneAtHours` was omitted from the payload, and
     * `serviceDue` counts an hours-based interval from
     * `(lastDoneAtHours ?? 0) + everyHours`. Target stays at 100 with the meter
     * at 110, so the job is still overdue the moment it is marked done, for
     * ever.
     *
     * The date half landed, which is what made it so hard to argue with: the
     * screen said "Last done August 11" while the farm list still demanded it.
     * Everything looked recorded and nothing had changed.
     *
     * `?? 0` in the engine is right and stays — a machine bought at 900 hours
     * with no service history IS overdue, and quietly restarting its clock
     * would be the worse lie. The fault is here: this screen has the reading,
     * shows it, and then threw it away.
     */
    const typed = Number(atHours);
    const reading =
      Number.isFinite(typed) && typed > 0 ? typed : (machine?.hours ?? null);

    void save(async () => {
      await log({
        entity: 'maintenance',
        op: 'update',
        targetId: service.id,
        payload: {
          lastDoneAtDate: Date.now(),
          ...(service.intervalHours !== undefined && reading !== null && reading > 0
            ? { lastDoneAtHours: reading }
            : {}),
        },
      });

      /**
       * A failed check becomes a job, and that is the whole point of the list.
       *
       * A checklist that only ticked boxes would be a printed card with extra
       * steps. What a keeper actually needs is for "hydraulic hose weeping" —
       * noticed at eight in the morning with the tractor running and both
       * hands dirty — to still exist at four in the afternoon. `task` is the
       * one authored due kind and this is exactly what it is for.
       *
       * Written after the service, in the order that survives a partial
       * failure best: the service being recorded is the fact, and a job raised
       * against a service that was never marked done would sit on Today
       * pointing at nothing. No date, so they land on the Jobs list and never
       * nag; `subjectId` ties each one to the machine it was found on.
       */
      for (const line of wrong) {
        await log({
          entity: 'task',
          op: 'create',
          targetId: newId(),
          payload: {
            title: `${line} — ${machine?.name ?? service.title}`,
            recurrence: 'none',
            ...(machine === null ? {} : { subjectId: machine.id }),
            note: `Found while doing ${service.title}.`,
          },
        });
      }
    });
  }, [save, log, service, atHours, wrong, machine]);

  const drop = useCallback(() => {
    if (service === null) return;
    void removed.save(async () => {
      await log({
        entity: 'maintenance',
        op: 'delete',
        targetId: service.id,
        payload: { reason: 'No longer wanted' },
      });
    });
  }, [removed, log, service]);

  if (services === null || machines === null) return <Loading title="Service" />;
  if (service === null) return <Missing title="Service" what="That schedule" />;

  const partsById = new Map((inventory ?? []).map((item) => [item.id, item]));
  const parts = (service.partIds ?? []).flatMap((id) => {
    const item = partsById.get(id);
    return item === undefined ? [] : [{ id, name: item.name, quantity: item.quantity }];
  });
  const short = partsNote(parts);
  const checks = service.checks ?? [];

  return (
    <Screen title={service.title} back>
      {machine === null ? null : (
        <Text style={[styles.label, { color: colors.muted }]}>{machine.name}</Text>
      )}

      <Panel label="How often">
        <Body>
          {[
            service.intervalHours === undefined ? null : `Every ${service.intervalHours} hours.`,
            service.intervalDays === undefined ? null : `Every ${service.intervalDays} days.`,
          ]
            .filter((part): part is string => part !== null)
            .join(' ')}
        </Body>
        <Body>
          {service.lastDoneAtDate === undefined
            ? 'Never recorded as done — which is why it is counted from zero rather than from today.'
            : `Last done ${new Date(service.lastDoneAtDate).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}${
                service.lastDoneAtHours === undefined ? '' : ` at ${service.lastDoneAtHours} hours`
              }.`}
        </Body>
      </Panel>

      {short === null ? null : (
        <Panel label="Parts">
          <Body>{short}</Body>
        </Panel>
      )}

      {/**
        * The walkaround (P15), and it is a list of toggles rather than a list
        * of text because the answer is nearly always "all fine" — which
        * should cost no taps at all.
        */}
      {checks.length === 0 ? null : (
        <Field
          label="Have a look at these"
          hint="Tick anything that is not right. Each one becomes a job on the farm list; leave the rest alone."
        >
          {checks.map((line) => (
            <Toggle
              key={line}
              label={line}
              value={wrong.includes(line)}
              onChange={(on) =>
                setWrong((current) =>
                  on ? [...current, line] : current.filter((c) => c !== line),
                )
              }
            />
          ))}
        </Field>
      )}

      {service.intervalHours === undefined ? null : (
        <Field
          label="Meter reading now"
          hint={
            machine?.hours === null || machine?.hours === undefined
              ? 'The interval counts from this, not from the last hour log — those are minutes apart on the day of a service.'
              : // Says what an untouched field does, because it is not nothing
                // and a grey placeholder cannot tell you which it is.
                `The interval counts from this. Leave it and ${machine.hours} hours is used — change it if the meter has moved since you did the work.`
          }
        >
          <NumberField
            value={atHours}
            onChangeText={setAtHours}
            placeholder={machine?.hours === null ? '1247' : String(machine?.hours ?? '')}
            suffix="hours"
            accessibilityLabel="Meter reading"
            testID="service-hours"
          />
        </Field>
      )}

      <Failure message={failure} />

      <Primary label="I have done it" disabled={saving} onPress={commit} testID="save-done" />

      <Panel label="Stop tracking this">
        <Body>
          Removing the schedule stops the reminders. Everything already recorded about the
          machine stays.
        </Body>
        <Failure message={removed.failure} />
        <Confirm label="Remove it" armedLabel="Tap again to remove" onConfirm={drop} />
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
