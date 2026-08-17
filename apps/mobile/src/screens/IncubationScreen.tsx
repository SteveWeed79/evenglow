import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import {
  candlingDay,
  INCUBATION_DAYS,
  incubationStage,
  libraryBreed,
} from '@steading/contracts';
import {
  fertilityRate,
  hatchRate,
  type IncubationEntry,
  listIncubations,
} from '@steading/core/read/breeding';
import { saidConfirmation } from '@steading/core/voice';
import { Coming } from '../components/Coming';
import { Confirmation, Failure, Field, Primary, Row, Stepper, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Notes } from '../components/Notes';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useLog } from '../hooks/useSync';
import { useLeave, useNav } from '../hooks/useNav';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * One set of eggs, and the two steps that close it.
 *
 * Candling first, then the hatch. Each is recorded by filling in its date, and
 * filling it in is what stops `incubationDues` producing that row — there is
 * no completion flag anywhere in this app, and this screen is the clearest
 * illustration of why that is enough.
 *
 * **Hatched and early losses are separate numbers.** Hatch rate and survival
 * rate are different figures, and a keeper diagnosing a bad set needs to know
 * which one moved: eggs that never pipped point at fertility or at the
 * incubator, chicks that died on day two point at brooder temperature.
 *
 * ## It gets `Coming` and deliberately not `Timeline`
 *
 * The other six detail screens take both halves. This one takes one, and the
 * asymmetry is a fact about the entity rather than an omission.
 *
 * A hatch **does** now land in What happened — `read/history.ts` was blind to
 * incubations entirely, which meant one of the few events on a poultry year
 * that anybody remembers the date of appeared nowhere but here. It reaches the
 * farm's history and the source group's timeline, where it is news.
 *
 * On this screen it would not be. Nothing else in the projection can ever name
 * an incubation, so the panel's only possible content is that single row —
 * *"Sussex eggs hatched · 8 chicks from 12 eggs set"* — sitting directly under
 * the identity line and the How it went panel, which already say the count, the
 * set date and both rates. A panel that can only restate the screen above it is
 * furniture, and this app's rule is that a component earns its place.
 */
export function IncubationScreen({ route }: ScreenProps<'Incubation'>): React.ReactElement {
  const { incubationId } = route.params;

  const incubations = useLive(listIncubations);
  const incubation = incubations?.find((i) => i.id === incubationId) ?? null;

  if (incubations === null) return <Loading title="Eggs" />;
  if (incubation === null) return <Missing title="Eggs" what="That set of eggs" />;

  return <Detail incubation={incubation} />;
}

function Detail({ incubation }: { incubation: IncubationEntry }): React.ReactElement {
  const log = useLog();
  const nav = useNav();
  const { colors } = useTheme();

  /**
   * The one count that does NOT start at zero, deliberately.
   *
   * Everywhere else a stepper starts at nothing, because a default is a number
   * the app chose and saving without touching it records a fact nobody
   * entered. Candling is the opposite motion: you set twelve, two are clear,
   * and the answer is ten. Starting at what was set means taking away the ones
   * that failed — which is what the person is actually doing — where starting
   * at zero would mean counting ten eggs back up one at a time.
   *
   * It is also not a number the app invented. It is the number already on the
   * record, offered back for correction.
   */
  const [fertile, setFertile] = useState(incubation.eggsSet);
  const [hatched, setHatched] = useState(0);
  const [earlyLosses, setEarlyLosses] = useState(0);

  const candled = useSaver(useCallback(() => undefined, []));
  const hatchedSaver = useSaver(useLeave());

  const days = INCUBATION_DAYS[incubation.species] ?? 21;

  /**
   * Read once per render off the clock, not held in state.
   *
   * A day count that ticked over on a timer would be a subscription to keep
   * alive for three weeks to change one word. The screen is re-entered every
   * morning by somebody who wants to know what today's job is, and re-entering
   * it is the refresh.
   */
  const stage =
    incubation.hatchedAt === undefined
      ? incubationStage(incubation.species, incubation.setAt, Date.now())
      : null;

  const recordCandling = useCallback(() => {
    void candled.save(
      async () => {
        await log({
          entity: 'incubation',
          op: 'update',
          targetId: incubation.id,
          payload: { candledAt: Date.now(), fertile },
        });
      },
      // Sets a stored date. The stepper keeps its number and the panel stays
      // exactly as it was, so without this nothing on screen moved at all.
      saidConfirmation('candling'),
    );
  }, [candled, log, incubation.id, fertile]);

  const recordHatch = useCallback(() => {
    void hatchedSaver.save(async () => {
      await log({
        entity: 'incubation',
        op: 'update',
        targetId: incubation.id,
        payload: {
          hatchedAt: Date.now(),
          hatched,
          ...(earlyLosses > 0 ? { earlyLosses } : {}),
        },
      });
    });
  }, [hatchedSaver, log, incubation.id, hatched, earlyLosses]);

  const fertilityPct = fertilityRate(incubation);
  const hatchPct = hatchRate(incubation);
  const breedName =
    incubation.breedId === undefined
      ? null
      : (libraryBreed(incubation.breedId)?.name ?? null);

  return (
    <Screen title={incubation.label} back>
      <Text style={[styles.label, { color: colors.muted }]}>
        {incubation.eggsSet} eggs · set{' '}
        {new Date(incubation.setAt).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'long',
        })}
        {/* Said here because the eggs were the last moment anybody knew for
            certain what these are. */}
        {breedName === null ? '' : ` · ${breedName}`}
      </Text>

      {/**
        * Where this set has got to, and it is derived rather than recorded.
        *
        * Only while it is running: once the hatch is in, the day count is
        * history and the panel below says what actually happened, which is
        * the more interesting number.
        */}
      {stage === null ? null : (
        <Panel label={stage.title}>
          <Body>{stage.guidance}</Body>
        </Panel>
      )}

      {/**
        * The two steps, as the engine sees them.
        *
        * The panels below each say "Due about 3 September" and that is a date
        * rather than a verdict: a set four days past its hatch reads exactly
        * like one due next week. `urgencyOf` is what knows the difference, and
        * an overdue row here is drawn in rowan and says "4 days ago".
        *
        * The dates stay where they are, because they are not the same
        * statement. `incubationDues` produces nothing at all for a species the
        * library has no incubation length for, while the panel falls back to
        * twenty-one days — so for a bird the app cannot model, the sentence in
        * the form is the only thing said, and it should be.
        *
        * `here` drops the tap: a candle row opens the Incubation screen, which
        * is this one. The row is drawn as text and the form beneath it is where
        * the step is actually discharged.
        */}
      <Coming subject={incubation.id} here="Incubation" />


      {fertilityPct === null && hatchPct === null ? null : (
        <Panel label="How it went">
          {fertilityPct === null ? null : (
            <Body>{Math.round(fertilityPct * 100)}% were fertile at candling.</Body>
          )}
          {hatchPct === null ? null : (
            <Body>
              {Math.round(hatchPct * 100)}% hatched
              {incubation.earlyLosses === undefined || incubation.earlyLosses === 0
                ? '.'
                : `, and ${incubation.earlyLosses} did not make the first days.`}
            </Body>
          )}
        </Panel>
      )}

      {incubation.candledAt === undefined ? (
        <Panel label="Candling">
          <Body>
            Due about {when(incubation.setAt, candlingDay(days))}. Hold each egg to a light and
            count the ones with something in them — the clears come out, and the space is worth
            more than the hope.
          </Body>
          <Field label="How many were fertile?">
            <Stepper value={fertile} onChange={setFertile} steps={[1, 6]} suffix="eggs" />
          </Field>
          <Failure message={candled.failure} />
          <Confirmation message={candled.said} />
          <Primary
            label="Record the candling"
            disabled={candled.saving}
            onPress={recordCandling}
            testID="save-candling"
          />
        </Panel>
      ) : (
        <Panel label="Candled">
          <Body>
            {new Date(incubation.candledAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
            })}
            {incubation.fertile === undefined ? '.' : ` — ${incubation.fertile} fertile.`}
          </Body>
        </Panel>
      )}

      <Notes
        subjectEntity="incubation"
        subjectId={incubation.id}
        subject={incubation.label}
      />

      <Panel label="This set">
        <Row
          title={`Change ${incubation.label}`}
          detail="What they are, how many went under, the date, and the counts"
          testID="go-edit-incubation"
          onPress={() => nav.navigate('EditIncubation', { incubationId: incubation.id })}
        />
      </Panel>

      {incubation.hatchedAt === undefined ? (
        <Panel label="The hatch">
          <Body>
            Due about {when(incubation.setAt, days)}. Recording it here is what takes both rows
            off Today — there is nothing to tick.
          </Body>
          <Field label="How many hatched?">
            <Stepper value={hatched} onChange={setHatched} steps={[1, 6]} suffix="chicks" />
          </Field>
          <Field
            label="Lost in the first days"
            hint="Kept apart from the hatch count on purpose: a bad hatch and a bad brooder are different problems."
          >
            <Stepper value={earlyLosses} onChange={setEarlyLosses} steps={[1]} />
          </Field>
          <Failure message={hatchedSaver.failure} />
          <Primary
            label="Record the hatch"
            disabled={hatchedSaver.saving}
            onPress={recordHatch}
            testID="save-hatch"
          />
        </Panel>
      ) : null}
    </Screen>
  );
}

const DAY_MS = 86_400_000;

function when(from: number, days: number): string {
  return new Date(from + days * DAY_MS).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
}

const styles = StyleSheet.create({
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: SPACE.xs,
  },
});
