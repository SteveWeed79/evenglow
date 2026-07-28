import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type ActiveWithdrawal, type Due, laysEggs, longestWithdrawal } from '@steading/contracts';
import type { Group } from '@steading/core/read/groups';
import { basketConfirmation } from '@steading/core/voice';
import { DueRow } from '../components/DueRow';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Tally } from '../components/Tally';
import { WithdrawalBanner } from '../components/WithdrawalBanner';
import { useDues } from '../hooks/useDues';
import { useGroups } from '../hooks/useGroups';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * Today — the log path, and nothing that competes with it (R1, R2).
 *
 * Reads entirely from the local projection, so it renders the same with the
 * radio off. Defining groups and recording treatments live under Stock; what
 * is here is what a person does at 6am with a bucket in one hand.
 *
 * The due list sits ABOVE the tallies, and that order is the argument: what is
 * due is what you did not already know. The tally is the thing you came to do
 * and will find whether or not it is at the top.
 */
export function TodayScreen(): React.ReactElement {
  const { groups, eggs, withdrawals, loading } = useGroups();
  const { dues } = useDues();
  const { colors } = useTheme();
  const nav = useNav();

  /**
   * Where a row is discharged.
   *
   * A due row says what is wanted and this says where it happens — a service
   * on its schedule, a hatch on its set of eggs, a husbandry job on its group.
   * `subject` is already on every `Due` for exactly this, so nothing here has
   * to re-derive which entity a row came from.
   */
  const openDue = useCallback(
    (due: Due): (() => void) | undefined => {
      const { entity, id } = due.subject;

      if (due.kind === 'candle' || due.kind === 'hatch') {
        return () => nav.navigate('Incubation', { incubationId: id });
      }
      if (entity === 'flock') return () => nav.navigate('Group', { groupId: id });
      if (entity === 'animal') return () => nav.navigate('Animals', { groupId: id });
      if (entity === 'equipment') return () => nav.navigate('Machine', { machineId: id });
      if (entity === 'planting') return () => nav.navigate('Planting', { plantingId: id });
      // A withdrawal names the medication, and there is no medication screen —
      // the group's banner is where it is actually read, and the row already
      // says which group. Left as a plain row rather than sent somewhere
      // approximate.
      return undefined;
    },
    [nav],
  );

  if (loading) return <Screen title="Today">{null}</Screen>;

  const layers = groups.filter((g) => laysEggs(g.species));
  const now = Date.now();

  return (
    <Screen title="Today">
      {dues.length > 0 ? (
        <View style={styles.dues}>
          {dues.map((due) => (
            <DueRow key={due.key} due={due} now={now} onPress={openDue(due)} />
          ))}
        </View>
      ) : null}

      {groups.length === 0 ? (
        <Panel label="Nothing to log yet">
          {/* Empty screens invite (UX-SPEC §6). */}
          <View style={styles.spot}>
            <Icon name="nest-box" size={56} color={colors.muted} />
          </View>
          <Body>Add what you keep under Stock, and the morning&rsquo;s tally lands here.</Body>
        </Panel>
      ) : null}

      {layers.map((group) => (
        <GroupTally
          key={group.id}
          group={group}
          eggs={eggs.get(group.id) ?? 0}
          withdrawal={longestWithdrawal(withdrawals.get(group.id) ?? [])}
        />
      ))}
    </Screen>
  );
}

function GroupTally({
  group,
  eggs,
  withdrawal,
}: {
  group: Group;
  eggs: number;
  withdrawal: ActiveWithdrawal | null;
}): React.ReactElement {
  const log = useLog();
  const { colors } = useTheme();

  const logEggs = useCallback(
    async (count: number, acknowledged: boolean) => {
      await log({
        entity: 'eggLog',
        op: 'create',
        payload: {
          occurredAt: Date.now(),
          flockId: group.id,
          count,
          // Recorded, not merely displayed: an acknowledged withdrawal is the
          // audit trail for a decision someone made deliberately.
          ...(acknowledged ? { withdrawalAcknowledged: true } : {}),
        },
      });
    },
    [log, group.id],
  );

  return (
    <View style={styles.group}>
      <View style={styles.head}>
        <View style={styles.name}>
          <Text style={[styles.groupName, { color: colors.ink }]}>{group.name}</Text>
          <Text style={[styles.label, { color: colors.muted }]}>{group.count} head</Text>
        </View>

        {/* A bare number opposite the group's name could be anything — head
            count, eggs, hours. It says what it is. */}
        {eggs > 0 ? (
          <View style={styles.today}>
            <Text style={[styles.todayCount, { color: colors.ink }]}>{eggs}</Text>
            <Text style={[styles.label, { color: colors.muted }]}>Eggs today</Text>
          </View>
        ) : null}
      </View>

      {/* Informs, does not interrupt (R10). */}
      {withdrawal ? <WithdrawalBanner withdrawal={withdrawal} /> : null}

      <Tally
        label={`Eggs from ${group.name}`}
        unit="eggs"
        requireConfirm={withdrawal !== null}
        confirm={basketConfirmation}
        onCommit={logEggs}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dues: { gap: SPACE.sm, marginBottom: SPACE.sm },
  spot: { alignItems: 'center', paddingVertical: SPACE.md },
  group: { gap: SPACE.sm },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  name: { flex: 1, gap: 2 },
  today: { alignItems: 'flex-end' },
  groupName: { fontFamily: FONTS.display, fontSize: TYPE.title },
  todayCount: { fontFamily: FONTS.display, fontSize: TYPE.title, fontVariant: ['tabular-nums'] },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
