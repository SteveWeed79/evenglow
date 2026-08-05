import { useCallback } from 'react';
import { listMachines } from '@steading/core/read/iron';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Tally } from '../components/Tally';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';

/**
 * Logging an hour meter.
 *
 * The Tally again, and the reuse is the point: an hour reading is entered the
 * same way an egg count is, by someone standing beside the machine with the
 * same gloves on. Different steps, because a meter moves in single hours and a
 * basket moves in dozens.
 */
export function LogHoursScreen({ route }: ScreenProps<'LogHours'>): React.ReactElement {
  const { machineId } = route.params;
  const nav = useNav();
  const log = useLog();

  const machines = useLive(listMachines);
  const machine = machines?.find((m) => m.id === machineId) ?? null;

  const commit = useCallback(
    async (hours: number) => {
      await log({
        entity: 'hourReading',
        op: 'create',
        payload: { occurredAt: Date.now(), equipmentId: machineId, hours },
      });
      nav.goBack();
    },
    [log, machineId, nav],
  );

  if (machines === null) return <Loading title="Hours" />;
  if (machine === null) return <Missing title="Hours" what="That machine" />;

  return (
    <Screen title={machine.name} back>
      <Panel label="Reading">
        <Body>
          Type what the meter says now, not the hours since last time. The app works out the
          difference, and a reading lower than the last one is refused by the server rather
          than quietly accepted.
        </Body>
        {machine.hours === null ? null : <Body>Last recorded: {machine.hours} hours.</Body>}
      </Panel>

      <Tally
        label={`Hour meter on ${machine.name}`}
        unit="hours"
        // Tens and hundreds: a meter reads 1,247, and starting from zero in
        // single taps would be absurd. The 100 step is what makes this usable.
        steps={[1, 10, 100]}
        /**
         * Not on the roadmap's list and fixed with it, because the panel
         * above has said "type what the meter says" since this screen was
         * written and there was nothing here to type into. 1,247 hours is
         * twenty-three taps; the copy was describing the control this should
         * always have offered.
         */
        typed
        onCommit={(value) => commit(value)}
      />
    </Screen>
  );
}
