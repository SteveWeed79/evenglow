import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { feedNeededUg, formatMass, gramsToUg, newId, poundsToUg } from '@steading/contracts';
import { currentFeedPlans, listGroups } from '@steading/core/read/groups';
import { listInventory } from '@steading/core/read/iron';
import {
  Choice,
  Confirm,
  Failure,
  Field,
  NumberField,
  Primary,
  TextField,
  useSaver,
} from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { useUnits } from '../hooks/useUnits';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * The ration — what a group *should* be fed.
 *
 * The last of the four entities that had a schema, a sync path and a server
 * applier and nothing that could write one. `feedLog` has recorded what went
 * in since the first schema; this is the other half, and without it
 * `feedNeededUg` has been arithmetic with nothing to work on since the day it
 * was written.
 *
 * ## What it buys, and it is one thing
 *
 * **A bag running out stops being a discovery.** Ration times head times days
 * is the plainest arithmetic in the app, and it is the difference between
 * noticing on Sunday that the feed bin is empty and having been told on
 * Tuesday to order. That is the row `useDues` now raises, and it is the only
 * reason this screen exists — a plan that produced no row would be a form
 * asking a farm to type in something it already knows.
 *
 * ## Per animal per day, not per group
 *
 * The schema stores it per animal because head count changes and the ration
 * does not: birds are sold, a doe kids, a fox visits. A per-group figure would
 * silently become wrong on every one of those days, and nobody would go back
 * and re-derive it.
 *
 * The screen still shows the group total underneath, because that is the
 * number a person can check against a scoop — a farm knows it puts about four
 * pounds in the trough, not that each hen gets a quarter of one.
 *
 * ## Superseding, not editing
 *
 * A new ration ends the old one rather than overwriting it, so a cost read
 * over last spring uses last spring's figure. Same reason `feedLog` stamps its
 * own cost at log time: a season's history rewritten by a change made in
 * August is history the farm cannot check.
 */
export function FeedPlanScreen({ route }: ScreenProps<'FeedPlan'>): React.ReactElement {
  const { groupId } = route.params;
  const log = useLog();
  const units = useUnits();
  const { colors } = useTheme();

  const groups = useLive(listGroups);
  const plans = useLive(currentFeedPlans);
  const shelf = useLive(listInventory);

  const group = groups?.find((g) => g.id === groupId) ?? null;
  const current = plans?.get(groupId) ?? null;

  const [feedName, setFeedName] = useState('');
  const [amount, setAmount] = useState('');

  /**
   * The shelf, so a ration names the sack it comes out of.
   *
   * The same argument the feed log makes: the farm already named the feed when
   * it put it on the shelf, and asking again produces two spellings of one
   * sack that no report can add together.
   */
  const fromShelf = useMemo(() => {
    const names = (shelf ?? [])
      .filter((item) => item.kind === 'feed')
      .filter(
        (item) => item.species === undefined || (group !== null && item.species.includes(group.species)),
      )
      .map((item) => item.name);
    return [...new Set(names)];
  }, [shelf, group]);

  const { saving, failure, save } = useSaver(useLeave());

  /** Ounces or grams — a hen's daily ration is a quarter pound, not a pound. */
  const perAnimalUg = useMemo(() => {
    const said = Number(amount);
    if (!Number.isFinite(said) || said <= 0) return null;
    return units === 'imperial' ? poundsToUg(said / 16) : gramsToUg(said);
  }, [amount, units]);

  const commit = useCallback(() => {
    if (perAnimalUg === null) return;

    void save(async () => {
      /**
       * The outgoing ration is ended before the new one starts, and in that
       * order, because two live plans is the one state `currentFeedPlans`
       * has to guess about. Ending first means a crash between the two writes
       * leaves a group with no ration — which shows as "no plan yet" and is
       * recoverable by typing it again — rather than two, which is silent.
       */
      if (current !== null) {
        await log({
          entity: 'feedPlan',
          op: 'update',
          targetId: current.id,
          payload: { endedAt: Date.now() },
        });
      }

      await log({
        entity: 'feedPlan',
        op: 'create',
        targetId: newId(),
        payload: {
          flockId: groupId,
          feedName: feedName.trim(),
          perAnimalPerDayUg: perAnimalUg,
          startedAt: Date.now(),
        },
      });
    });
  }, [save, log, groupId, feedName, perAnimalUg, current]);

  const stop = useCallback(() => {
    if (current === null) return;
    void save(async () => {
      await log({
        entity: 'feedPlan',
        op: 'update',
        targetId: current.id,
        payload: { endedAt: Date.now() },
      });
    });
  }, [save, log, current]);

  if (groups === null) return <Loading title="Ration" />;
  if (group === null) return <Missing title="Ration" what="That group" />;

  // What the group eats a day, which is the figure a person can check against
  // a scoop. Head count is today's — see the note on why the record is not.
  const dailyUg = perAnimalUg === null ? null : feedNeededUg(perAnimalUg, group.count, 1);
  const currentDailyUg =
    current === null ? null : feedNeededUg(current.perAnimalPerDayUg, group.count, 1);

  const unit = units === 'imperial' ? 'oz' : 'g';

  return (
    <Screen title="What they should get" back>
      <Text style={[styles.label, { color: colors.muted }]}>{group.name}</Text>

      {current === null ? (
        <Panel label="No ration yet">
          <Body>
            Say how much one animal gets a day and the app can tell you when the sack will run
            out — before it does, with time to order. Nothing else changes: what you actually feed
            is still recorded when you feed it.
          </Body>
        </Panel>
      ) : (
        <Panel label="Now">
          <Body>
            {current.feedName} — {formatMass(current.perAnimalPerDayUg, units)} each a day
            {currentDailyUg === null ? '' : `, ${formatMass(currentDailyUg, units)} for the ${group.count}`}.
          </Body>
          <Body>
            Since{' '}
            {new Date(current.startedAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            . Setting a new one ends this rather than rewriting it, so last season's costs stay
            what they were.
          </Body>
        </Panel>
      )}

      {fromShelf.length > 0 ? (
        <Field label="From the shelf">
          {/* Empty labels: `Choice` falls back to the option, which is already
              the farm's own word for the sack. */}
          <Choice options={fromShelf} value={feedName} onChange={setFeedName} labels={{}} />
        </Field>
      ) : null}

      <Field label={fromShelf.length > 0 ? 'Or something else' : 'What do they get?'}>
        <TextField
          value={feedName}
          onChangeText={setFeedName}
          placeholder="Layers pellets"
          maxLength={80}
          testID="plan-feed"
        />
      </Field>

      <Field
        label="How much does one get a day?"
        hint={
          units === 'imperial'
            ? 'In ounces — a laying hen is about 4, a goat far more.'
            : 'In grams — a laying hen is about 120, a goat far more.'
        }
      >
        <NumberField
          value={amount}
          onChangeText={setAmount}
          placeholder={units === 'imperial' ? '4' : '120'}
          suffix={unit}
          accessibilityLabel="Ration per animal per day"
          testID="plan-amount"
        />
      </Field>

      {dailyUg === null ? null : (
        <Text style={[styles.note, { color: colors.inkQuiet }]} testID="plan-total">
          {formatMass(dailyUg, units)} a day for {group.count}
          {group.count === 1 ? '' : ' of them'}.
        </Text>
      )}

      <Failure message={failure} />

      <Primary
        label={current === null ? 'Set the ration' : 'Change the ration'}
        disabled={saving || feedName.trim() === '' || perAnimalUg === null}
        onPress={commit}
        testID="save-plan"
      />

      {current === null ? null : (
        <Panel label="Stop planning this">
          <Body>
            Ends the ration without setting another. The feed you have logged stays; what stops is
            the app predicting when the sack runs out.
          </Body>
          <Confirm label="Stop it" armedLabel="Tap again to stop" onConfirm={stop} />
        </Panel>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { fontFamily: FONTS.body, fontSize: TYPE.body, marginTop: SPACE.xs },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
