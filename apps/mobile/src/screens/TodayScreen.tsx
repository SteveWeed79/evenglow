import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  type ActiveWithdrawal,
  dailyProductsOf,
  type Due,
  longestWithdrawal,
  type Product,
} from '@steading/contracts';
import type { Group } from '@steading/core/read/groups';
import { basketConfirmation } from '@steading/core/voice';
import { DueRow } from '../components/DueRow';
import { Icon, type IconName } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Tally } from '../components/Tally';
import { WithdrawalBanner } from '../components/WithdrawalBanner';
import { useDues } from '../hooks/useDues';
import { useGroups } from '../hooks/useGroups';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * Today — the log path, and nothing that competes with it (R1, R2).
 *
 * Reads entirely from the local projection, so it renders the same with the
 * radio off. The due list sits ABOVE the tallies, and that order is the
 * argument: what is due is what you did not already know. The tally is the
 * thing you came to do and will find whether or not it is at the top.
 *
 * ## Two corrections, both from watching it run on a phone
 *
 * **What is offered comes from what a group produces, not what its species
 * could.** This filtered on `laysEggs(species)` alone, so a flock named "Meat
 * Birds" got an egg tally every morning that nobody would ever fill in, and a
 * dairy goat keeper got nothing at all — milk was not on Today. `productsOf`
 * intersects the species' capability with the keeper's stated purpose, so a
 * group gives you exactly the tallies it earns. Both, for a flock kept for
 * eggs and then the table.
 *
 * **One tally is open at a time.** Each one is a full arch with a 90pt
 * numeral, so three groups made a screen you had to scroll past rather than
 * read. They collapse to a row carrying the name, the product and what has
 * been logged so far.
 *
 * The exception is a farm with exactly one thing to log, where the collapsed
 * row would be a tap between somebody and the only reason they opened the app.
 * That one opens itself.
 */

const MARKS: Record<Product, IconName> = { eggs: 'egg', milk: 'milk', fibre: 'basic-full' };
const UNITS: Record<Product, string> = { eggs: 'eggs', milk: 'ml', fibre: 'g' };
const STEPS: Record<Product, readonly number[]> = {
  eggs: [1, 6, 12],
  milk: [50, 100, 500],
  fibre: [100, 500],
};

interface Loggable {
  key: string;
  group: Group;
  product: Product;
}

export function TodayScreen(): React.ReactElement {
  const { groups, eggs, produce, withdrawals, loading } = useGroups();
  const { dues } = useDues();
  const { colors } = useTheme();
  const nav = useNav();

  /**
   * Where a row is discharged.
   *
   * A due row says what is wanted and this says where it happens — a service
   * on its schedule, a hatch on its set of eggs, a husbandry job on its group.
   * `subject` is already on every `Due` for exactly this.
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
      // A withdrawal names the medication and there is no medication screen —
      // the group's banner is where it is read, and the row says which group.
      return undefined;
    },
    [nav],
  );

  const loggable = useMemo<Loggable[]>(
    () =>
      groups.flatMap((group) =>
        dailyProductsOf(group.species, group.purposes ?? []).map((product) => ({
          key: `${group.id}:${product}`,
          group,
          product,
        })),
      ),
    [groups],
  );

  const [opened, setOpened] = useState<string | null>(null);
  // A farm with one thing to log should not have to tap to reach it.
  const open = loggable.length === 1 ? loggable[0]!.key : opened;

  if (loading) return <Screen title="Today">{null}</Screen>;

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

      {groups.length > 0 && loggable.length === 0 ? (
        <Panel label="Nothing to collect">
          <Body>
            None of your groups is kept for something collected daily. Change what a group is
            for under Stock and its tally appears here.
          </Body>
        </Panel>
      ) : null}

      {loggable.map((item) => (
        <ProductTally
          key={item.key}
          item={item}
          today={
            item.product === 'eggs'
              ? (eggs.get(item.group.id) ?? 0)
              : (produce.get(`${item.group.id}:${item.product}`)?.amount ?? 0)
          }
          withdrawal={longestWithdrawal(withdrawals.get(item.group.id) ?? [])}
          open={open === item.key}
          // The only one open closes on a second tap; any other opens instead.
          onToggle={() => setOpened(open === item.key ? null : item.key)}
        />
      ))}
    </Screen>
  );
}

function ProductTally({
  item,
  today,
  withdrawal,
  open,
  onToggle,
}: {
  item: Loggable;
  today: number;
  withdrawal: ActiveWithdrawal | null;
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const log = useLog();
  const { colors } = useTheme();
  const { group, product } = item;

  const commit = useCallback(
    async (amount: number, acknowledged: boolean) => {
      if (product === 'eggs') {
        await log({
          entity: 'eggLog',
          op: 'create',
          payload: {
            occurredAt: Date.now(),
            flockId: group.id,
            count: amount,
            // Recorded, not merely displayed: an acknowledged withdrawal is
            // the audit trail for a decision someone made deliberately.
            ...(acknowledged ? { withdrawalAcknowledged: true } : {}),
          },
        });
        return;
      }

      await log({
        entity: 'productionLog',
        op: 'create',
        payload: {
          occurredAt: Date.now(),
          flockId: group.id,
          kind: product,
          amount,
          unit: product === 'milk' ? 'ml' : 'g',
          ...(acknowledged ? { withdrawalAcknowledged: true } : {}),
        },
      });
    },
    [log, group.id, product],
  );

  const heading = product === 'eggs' ? 'Eggs' : product === 'milk' ? 'Milk' : 'Fibre';

  return (
    <View style={styles.group}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${heading} from ${group.name}. ${today} so far today.`}
        testID={`tally-open-${item.key}`}
        style={({ pressed }) => [
          styles.head,
          {
            backgroundColor: colors.raised,
            borderColor: open ? colors.lanternInk : colors.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Icon name={MARKS[product]} size={24} color={open ? colors.lanternInk : colors.muted} />

        <View style={styles.name}>
          <Text style={[styles.groupName, { color: colors.ink }]}>{group.name}</Text>
          <Text style={[styles.label, { color: colors.muted }]}>
            {heading} · {group.count} head
          </Text>
        </View>

        {/* The number, still visible when collapsed — it is the answer to the
            only question somebody asks before deciding to open this. */}
        {today > 0 ? (
          <View style={styles.today}>
            <Text style={[styles.todayCount, { color: colors.ink }]}>{today}</Text>
            <Text style={[styles.label, { color: colors.muted }]}>
              {product === 'eggs' ? 'today' : `${UNITS[product]} today`}
            </Text>
          </View>
        ) : null}

        <Icon name={open ? 'minus' : 'plus'} size={20} color={colors.muted} />
      </Pressable>

      {open ? (
        <>
          {/* Informs, does not interrupt (R10). */}
          {withdrawal ? <WithdrawalBanner withdrawal={withdrawal} /> : null}

          <Tally
            label={`${heading} from ${group.name}`}
            unit={UNITS[product]}
            steps={STEPS[product]}
            requireConfirm={withdrawal !== null}
            {...(product === 'eggs' ? { confirm: basketConfirmation } : {})}
            onCommit={commit}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dues: { gap: SPACE.sm, marginBottom: SPACE.sm },
  spot: { alignItems: 'center', paddingVertical: SPACE.md },
  group: { gap: SPACE.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
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
