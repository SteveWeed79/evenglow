import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type ActiveWithdrawal, dailyProductsOf, type Due, type DueBundle, enteredToStored, entryUnit, gramsToUg, longestWithdrawal, massIn, type Measure, mlToUl, type Product, todayBundles, type UnitSystem, volumeIn } from '@steading/contracts';
import type { Group } from '@steading/core/read/groups';
import { basketConfirmation } from '@steading/core/voice';
import { DueRow } from '../components/DueRow';
import { ExposureNotice } from '../components/ExposureNotice';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Tally } from '../components/Tally';
import { Touch } from '../components/Touch';
import { WeatherRow } from '../components/WeatherRow';
import { WeatherAlerts } from '../components/WeatherAlerts';
import { WeatherWarnings } from '../components/WeatherWarnings';
import { WithdrawalBanner } from '../components/WithdrawalBanner';
import { useDues } from '../hooks/useDues';
import { useFarmName } from '../hooks/useFarmName';
import { useGroups } from '../hooks/useGroups';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { useUnits } from '../hooks/useUnits';
import { reportTrouble } from '../hooks/useTrouble';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * Today — the log path, and nothing that competes with it (R1, R2).
 *
 * Reads entirely from the local projection, so it renders the same with the
 * radio off.
 *
 * ## The tally comes first, and that is a reversal
 *
 * This screen used to put the whole due list above the tallies, on the
 * argument that what is due is what you did not already know, while the tally
 * is the thing you came to do and would find anyway.
 *
 * A phone disproved it. Bundling gave each group a row plus an "and 3 more"
 * line, so three groups of routine look-overs filled the screen and the egg
 * tally — the one thing that gets tapped every single morning — started below
 * the fold. "Would find it anyway" turned out to mean "would scroll past six
 * rows of things that are not urgent, every day, to reach it".
 *
 * `VISIBLE_DUES` was supposed to prevent exactly that and could not: it counts
 * bundles, and a bundle is not one line.
 *
 * **Nothing is held back above it, and the withdrawal case is why that is
 * safe.** The obvious worry is W2: withdrawals are the highest-value safety
 * surface in the app, so burying one under a tally would be a bad trade.
 *
 * It is not the trade being made. A withdrawal row has `noticeDays: 0` and
 * says "eggs clear again after Baytril" — it appears on the day the withdrawal
 * *ends*, so it is the all-clear, not a warning about collecting now. While
 * produce is actually being withheld there is no due row at all.
 *
 * The warning for that lives on the tally and travels with it: an open tally
 * under a withdrawal shows a `WithdrawalBanner` and will not commit without a
 * second, deliberate press. Moving the list does not move the guard, because
 * the guard was never in the list.
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

/**
 * How many of the day's jobs are listed before it offers the rest.
 *
 * No longer a fold calculation — the tallies are above these now, so nothing
 * is being pushed off a screen. It is a readability cap: a farm in spring can
 * produce twenty rows, and a list that long at the bottom of Today is one
 * nobody finishes reading.
 */
const VISIBLE_DUES = 5;
/** What `productionLog` stores this product as. Eggs are counted, not measured. */
const STORED: Record<Exclude<Product, 'eggs'>, 'ml' | 'g'> = { milk: 'ml', fibre: 'g' };

/**
 * Steps in the fine unit of each system, chosen as vessels rather than as
 * conversions of each other.
 *
 * A farm counting in fluid ounces reaches for a cup, a pint and a quart; one
 * counting in millilitres does not think in 237s. Converting the metric steps
 * would have produced exactly that.
 */
const STEPS: Record<Product, Record<UnitSystem, readonly number[]>> = {
  eggs: { metric: [1, 6, 12], imperial: [1, 6, 12] },
  milk: { metric: [50, 100, 500], imperial: [8, 16, 32] },
  fibre: { metric: [100, 500], imperial: [4, 16] },
};

/**
 * The running total, scaled to whatever the farm reads in.
 *
 * Eggs are counted rather than measured, so they have no unit and the row
 * says only "today" beneath the number.
 */
function producedIn(product: Product, amount: number, units: UnitSystem): Measure {
  if (product === 'eggs') return { value: String(amount), unit: '' };
  return product === 'milk' ? volumeIn(mlToUl(amount), units) : massIn(gramsToUg(amount), units);
}

interface Loggable {
  key: string;
  group: Group;
  product: Product;
}

export function TodayScreen(): React.ReactElement {
  const { groups, eggs, produce, withdrawals, loading } = useGroups();
  const { dues } = useDues();
  const { colors } = useTheme();
  const farmName = useFarmName();
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

  /**
   * The morning's rows, gathered per group and capped.
   *
   * Two problems, one shape. `careDues` emits a row per care kind per group,
   * so a two-group farm that has recorded no husbandry opens on nine rows
   * differing by one word — and a list like that is one nobody reads. And
   * however few rows there are, an unbounded list pushes the tally, which is
   * what most people opened the app to reach, off the bottom of the screen.
   *
   * Bundling is in the due engine where it is tested (`todayBundles`); the cap
   * is here, because it is a fact about a screen rather than about the farm.
   */
  const bundles = useMemo(() => todayBundles(dues, Date.now()), [dues]);

  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? bundles : bundles.slice(0, VISIBLE_DUES);

  const [opened, setOpened] = useState<string | null>(null);
  // A farm with one thing to log should not have to tap to reach it.
  const open = loggable.length === 1 ? loggable[0]!.key : opened;

  if (loading) return <Screen title="Today">{null}</Screen>;

  const now = Date.now();

  return (
    /* The app has held this name since signup and never said it. A farm that
       never signed in has none, and gets the plain title — D14 is a supported
       state, not an unfinished one. */
    <Screen title="Today" {...(farmName === null ? {} : { subtitle: farmName })}>
      {/* What the weather MEANS comes before what it is, and both come before
          the tallies. Warnings are silent on an ordinary day, so this costs
          nothing on the mornings it has nothing to say — see WeatherWarnings.
          The row below it is one line, so neither displaces a tally.

          An official alert outranks all of it. The strip below this one is
          this app's opinion about the farm's own animals; that one is a
          meteorologist saying a tornado is on the ground, and a farm reading
          top to bottom must not meet "your hens are warm" first. */}
      <WeatherAlerts />
      <WeatherWarnings />
      <WeatherRow />

      {/* Below the weather and above the tallies, and both halves of that are
          arguments. A meteorologist saying a tornado is on the ground outranks
          this app's opinion about filing. And below the tallies is where a
          thing goes to be scrolled past — which is precisely what the Settings
          row this replaces had already become. Silent on a farm that syncs,
          silent on a new one, and it ends when somebody acts rather than when
          they agree to stop being told. */}
      <ExposureNotice />

      {groups.length === 0 ? (
        <Panel label="Nothing to log yet">
          {/* Empty screens invite (UX-SPEC §6). */}
          <View style={styles.spot}>
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

      {bundles.length > 0 ? (
        <View style={styles.duesBelow}>
          {/* Named, because a list of jobs under the tallies with no heading
              reads as more tallies until you have read one. */}
          <Text style={[styles.moreLabel, { color: colors.muted }]}>Also today</Text>

          {shown.map((bundle) => (
            <DueBundleRow key={bundle.key} bundle={bundle} now={now} open={openDue} />
          ))}

          {bundles.length > shown.length ? (
            <Touch affordance="disclose"
              onPress={() => setShowAll(true)}
              accessibilityRole="button"
              testID="show-all-dues"
              style={({ pressed }) => [styles.more, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.moreLabel, { color: colors.muted }]}>
                Show all {bundles.length}
              </Text>
            </Touch>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * One bundle: its most pressing row, and the rest a tap away.
 *
 * Collapsed by default and expanded in place rather than navigated to, because
 * the other rows are the same kind of thing — four husbandry jobs on one group
 * — and a screen change to read three more lines is a change nobody asked for.
 */
function DueBundleRow({
  bundle,
  now,
  open,
}: {
  bundle: DueBundle;
  now: number;
  open: (due: Due) => (() => void) | undefined;
}): React.ReactElement {
  const { colors } = useTheme();
  const log = useLog();
  const [expanded, setExpanded] = useState(false);

  /**
   * Writes the record the row was waiting for, which is what clears it.
   *
   * **Not a completion flag** — see `Due.done`. This enqueues the same
   * `careLog` the form would have written, so the row disappears on the next
   * recomputation because the record now exists, and the job shows up in What
   * happened. There is still nothing anywhere that stores "done".
   */
  const finish = useCallback(
    (due: Due): (() => void) | undefined => {
      const done = due.done;
      if (done === undefined) return undefined;

      return () => {
        /**
         * A failed write is said out loud, not dropped.
         *
         * This was `void log(...)` with nothing after it, so a refused
         * mutation vanished and the row simply came back — indistinguishable
         * from never having pressed the button, which is exactly the report
         * that led here. The press is fire-and-forget by design (R6: a log is
         * bounded by one SQLite transaction, never by signal), but
         * fire-and-forget must still mean somebody hears about a fire that did
         * not light.
         */
        void log({
          entity: done.entity,
          op: done.op,
          // A create mints its own id; an update names the row it changes.
          ...(done.targetId === undefined ? {} : { targetId: done.targetId }),
          payload: { ...done.payload, [done.stampAs]: Date.now() },
        }).catch((error: unknown) => reportTrouble(`recording ${done.label.toLowerCase()}`, error));
      };
    },
    [log],
  );

  const rest = bundle.dues.length - 1;
  if (rest === 0) {
    return (
      <DueRow due={bundle.lead} now={now} onPress={open(bundle.lead)} onDone={finish(bundle.lead)} />
    );
  }

  return (
    <View style={styles.bundle}>
      <DueRow due={bundle.lead} now={now} onPress={open(bundle.lead)} onDone={finish(bundle.lead)} />

      {expanded ? (
        bundle.dues.slice(1).map((due) => (
          <DueRow key={due.key} due={due} now={now} onPress={open(due)} onDone={finish(due)} />
        ))
      ) : null}

      <Touch affordance="disclose"
        onPress={() => setExpanded(!expanded)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        // Said in full, because "+3" read aloud on its own means nothing.
        accessibilityLabel={
          expanded
            ? `Hide the other ${rest} jobs for this group`
            : `Show ${rest} more ${rest === 1 ? 'job' : 'jobs'} for this group`
        }
        testID={`bundle-more-${bundle.key}`}
        hitSlop={8}
        style={({ pressed }) => [styles.more, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[styles.moreLabel, { color: colors.muted }]}>
          {expanded ? 'Fewer' : `and ${rest} more`}
        </Text>
      </Touch>
    </View>
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
  const nav = useNav();
  const { colors } = useTheme();
  const units = useUnits();
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

      const stored = STORED[product];

      await log({
        entity: 'productionLog',
        op: 'create',
        payload: {
          occurredAt: Date.now(),
          flockId: group.id,
          kind: product,
          // The stepper counted in the farm's unit; the schema takes mL or g.
          amount: enteredToStored(amount, stored, units),
          unit: stored,
          ...(acknowledged ? { withdrawalAcknowledged: true } : {}),
        },
      });
    },
    [log, group.id, product, units],
  );

  const heading = product === 'eggs' ? 'Eggs' : product === 'milk' ? 'Milk' : 'Fibre';
  const produced = producedIn(product, today, units);
  // Read aloud with its unit: "100 so far today" is a number about nothing.
  const spoken = produced.unit === '' ? produced.value : `${produced.value} ${produced.unit}`;

  return (
    <View style={styles.group}>
      <Touch affordance="unsignalled"
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${heading} from ${group.name}. ${spoken} so far today.`}
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
            <Text style={[styles.todayCount, { color: colors.ink }]}>{produced.value}</Text>
            <Text style={[styles.label, { color: colors.muted }]}>
              {produced.unit === '' ? 'today' : `${produced.unit} today`}
            </Text>
          </View>
        ) : null}

        <Icon name={open ? 'minus' : 'plus'} size={20} color={colors.muted} />
      </Touch>

      {open ? (
        <>
          {/* Informs, does not interrupt (R10). */}
          {withdrawal ? <WithdrawalBanner withdrawal={withdrawal} /> : null}

          <Tally
            label={`${heading} from ${group.name}`}
            unit={product === 'eggs' ? 'eggs' : entryUnit(STORED[product], units)}
            steps={STEPS[product][units]}
            /**
             * Everything but eggs, and the exception is the whole point.
             *
             * A basket is a dozen or two and R5 is written for it: steppers,
             * through a glove, three taps. A herd's milking on the same
             * screen is five gallons, which the steps cannot reach — and this
             * is the tally a farm actually opens, so leaving the door on the
             * Produce screen alone would have fixed it everywhere except
             * where it is used.
             */
            typed={product !== 'eggs'}
            requireConfirm={withdrawal !== null}
            {...(product === 'eggs' ? { confirm: basketConfirmation } : {})}
            onCommit={commit}
          />

          {/**
            * The way back out, at the place the mistake is visible.
            *
            * Taking a produce record back has existed since the day it was
            * asked for, on "What happened" — and the farm that asked for it
            * reported not being able to find it, from a handset. That is a
            * fair verdict: this screen shows a TOTAL, so the wrong twelve eggs
            * are visible here and the individual record that caused them is
            * two taps away on a screen behind a different tab.
            *
            * Only when something has actually been logged today, because on a
            * tally of nothing there is nothing to put right and the line would
            * be furniture.
            */}
          {today > 0 ? (
            <Touch
              affordance="chevron"
              onPress={() => nav.navigate('Tabs', { screen: 'History' })}
              accessibilityRole="button"
              testID={`tally-fix-${item.key}`}
              style={({ pressed }) => [styles.fix, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.label, { color: colors.muted }]}>
                Logged the wrong one? Put it right in What happened
              </Text>
            </Touch>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fix: { alignSelf: 'flex-start', paddingVertical: SPACE.xs, paddingHorizontal: SPACE.md },
  dues: { gap: SPACE.sm, marginBottom: SPACE.sm },
  duesBelow: { gap: SPACE.sm, marginTop: SPACE.md },
  bundle: { gap: SPACE.xs },
  more: { alignSelf: 'flex-start', paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm },
  moreLabel: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
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
