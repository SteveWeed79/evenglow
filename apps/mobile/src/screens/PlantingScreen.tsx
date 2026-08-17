import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { expectedHarvestAt, formatMass, PLANTING_STATUSES } from '@steading/contracts';
import {
  harvestTotals,
  listBeds,
  listHarvests,
  listPlantings,
  listVarieties,
} from '@steading/core/read/growing';
import { saidConfirmation } from '@steading/core/voice';
import {
  Chip,
  Confirm,
  Confirmation,
  DayPick,
  Failure,
  Primary,
  Row,
  Secondary,
  useSaver,
} from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Notes } from '../components/Notes';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Coming } from '../components/Coming';
import { Timeline } from '../components/Timeline';
import { useLive } from '../hooks/useLive';
import { useLeave, useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { useUnits } from '../hooks/useUnits';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * One planting, from planned to pulled.
 *
 * **The buttons here are how growing dues clear.** `growingDues` produces a
 * sow row until `sownAt` is set, a transplant row until `transplantedAt` is
 * set, and a harvest row until the status reaches `harvesting`. Nothing is
 * ticked off — recording what happened is what stops the row being produced,
 * and until this screen existed there was no way to record any of it, so every
 * planting's four stage rows were permanent.
 *
 * The transplant button waits on the indoor start for the reason the builder
 * does: seedlings that were never started cannot be moved out, and offering
 * the action would be the app being confidently wrong about the state of
 * somebody's propagator.
 *
 * ## The day it happened, not the day it was typed
 *
 * These buttons stamped `Date.now()`, which quietly asserted that nobody
 * records anything in the evening about a morning, or on Sunday about Friday.
 * On an app whose whole premise is that a phone comes out of a pocket in a
 * field when it can, that is the wrong assumption — and it is not cosmetic:
 * `sownAt` is what harvest is counted from, so a pumpkin recorded four days
 * late is a pumpkin the app expects four days early for the rest of the season.
 *
 * So there is a date, it defaults to today, and it is **one line above the
 * buttons rather than a field between them**. The common case is still one
 * press and the buttons have not moved; backdating costs a tap and is visible
 * before the press rather than discovered after it.
 */

/** Local midnight, which is the resolution every date in this app is kept at. */
function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}
export function PlantingScreen({ route }: ScreenProps<'Planting'>): React.ReactElement {
  const { plantingId } = route.params;
  const nav = useNav();
  const log = useLog();
  const { colors } = useTheme();
  const units = useUnits();

  const plantings = useLive(listPlantings);
  const varieties = useLive(listVarieties);
  const beds = useLive(listBeds);
  const harvests = useLive(listHarvests);

  const planting = plantings?.find((p) => p.id === plantingId) ?? null;

  const { saving, failure, said, save } = useSaver(useCallback(() => undefined, []));
  const pulled = useSaver(useLeave());

  /**
   * When the thing being recorded actually happened.
   *
   * Local midnight, which is what `DayPick` produces and what every other date
   * on this app is stored at — a hatch, a mating, a birth. A planting date is
   * the same kind of fact and there is no reason for it to be the one that
   * carries a time of day.
   */
  const [at, setAt] = useState(startOfToday());
  const [picking, setPicking] = useState(false);

  const mark = useCallback(
    (payload: Record<string, unknown>) => {
      void save(
        async () => {
          await log({ entity: 'planting', op: 'update', targetId: plantingId, payload });
        },
        // Every one of these buttons writes a status and leaves the screen
        // looking the same. Pressing "It is ready" twice was indistinguishable
        // from pressing it once and having it fail.
        saidConfirmation('planting'),
      );
    },
    [save, log, plantingId],
  );

  if (plantings === null) return <Loading title="Planting" />;
  if (planting === null) return <Missing title="Planting" what="That planting" />;

  const variety = varieties?.find((v) => v.id === planting.varietyId);
  const bed = beds?.find((b) => b.id === planting.bedId);
  const totals = harvestTotals(harvests ?? [], plantingId);

  /**
   * When it should be ready, in one sentence, or nothing.
   *
   * Nothing once it is finished, and "being picked" once it is — the estimate
   * is a prediction and the plant has already answered it. Nothing either when
   * there is no estimate to make, which is a variety somebody added without
   * filling in the days: a rough date beats no date, an invented one does not.
   */
  const readyAt = expectedHarvestAt(planting, variety?.daysToMaturity);
  const on = (at: number): string =>
    new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  const ready = ((): string | null => {
    if (planting.status === 'finished' || planting.status === 'failed') return null;
    if (planting.status === 'harvesting') return 'Being picked now.';
    if (readyAt === undefined) return null;
    return readyAt <= Date.now()
      ? `Should be ready — due about ${on(readyAt)}.`
      : `Ready about ${on(readyAt)}.`;
  })();

  const started = planting.startedIndoorsAt !== undefined;
  const needsIndoorStart = planting.plannedStartIndoorsAt !== undefined;

  const canStartIndoors = needsIndoorStart && !started;
  const canSow = planting.sownAt === undefined && !needsIndoorStart;
  /**
   * Gated on the indoor start for the same reason the due builder is — and on
   * there being a transplant stage at all, which the gate used to be missing.
   *
   * **A direct-sown crop offered both buttons.** "Sowed it" and "Planted it
   * out" sat side by side for a pumpkin that goes straight in the ground, and
   * pressing the second one recorded a transplant that never happened while
   * leaving the sowing unrecorded — so the sow row stayed outstanding over a
   * bed with a plant in it.
   *
   * `plannedTransplantAt` is what says a variety has that stage. The due
   * builder has always required it, because `add` returns early on an absent
   * date; this button never asked.
   */
  const canPlantOut =
    planting.transplantedAt === undefined &&
    planting.plannedTransplantAt !== undefined &&
    (!needsIndoorStart || started);

  /** Only the three stage buttons take a date. Picking and pulling do not. */
  const dated = canStartIndoors || canSow || canPlantOut;
  const today = startOfToday();
  const when =
    at === today
      ? 'today'
      : new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <Screen title={variety?.name ?? 'A planting'} back>
      <Text style={[styles.label, { color: colors.muted }]}>
        {variety?.crop ?? 'Growing'} · {bed?.name ?? 'a bed'} · season {planting.season}
      </Text>

      {/*
        The two things this planting belongs to, both of which now have a
        screen. A planting is one season in a bed's succession and one entry in
        a variety's record — before these rows, both of those were reachable
        only by remembering which bed you came from.
      */}
      <Panel label="Part of">
        {bed === undefined ? null : (
          <Row
            title={bed.name}
            detail="What is in it, and what has been"
            testID="go-bed"
            onPress={() => nav.navigate('Bed', { bedId: planting.bedId })}
          />
        )}
        {variety === undefined ? null : (
          <Row
            title={variety.name}
            detail="What it asks for, and how it has done here"
            testID="go-variety"
            onPress={() => nav.navigate('Variety', { varietyId: planting.varietyId })}
          />
        )}
      </Panel>

      <Panel label="Where it is">
        <Body>{describe(planting)}</Body>
        {/**
          * The date the app already knew and never said.
          *
          * `expectedHarvestAt` has been computed all along to raise the harvest
          * due row; it was simply never shown on the screen about the planting.
          * Asked plainly: *"if we know how long it takes roughly for things to
          * grow why are we not showing a projected harvest date?"*
          *
          * "About", and it stays "about" — days to maturity is a fair season in
          * a fair year, not a promise, and a farm that reads it as one will
          * trust it less the first time the weather disagrees.
          */}
        {ready === null ? null : <Body>{ready}</Body>}
      </Panel>

      {/**
        * One line, above the buttons, saying what day the press will record.
        *
        * Above rather than below because a default somebody has to press a
        * button to discover is a default they discover by getting it wrong. It
        * is a chip rather than an open `DayPick` because twelve month chips
        * standing permanently between the heading and "Sowed it" would cost the
        * one-press case to serve the occasional one.
        */}
      {dated ? (
        <View style={styles.when}>
          <Text style={[styles.whenLabel, { color: colors.muted }]}>Recording for</Text>
          <Chip
            label={when}
            selected={picking}
            onPress={() => setPicking(!picking)}
            testID="planting-when"
          />
        </View>
      ) : null}

      {dated && picking ? <DayPick value={at} onChange={setAt} /> : null}

      {/**
        * A date after today is not refused, only said out loud.
        *
        * It is very probably a mis-tap on the day field, and saying so is worth
        * doing because a sowing dated forward pushes the harvest estimate the
        * same distance. But `DOMAIN-SCOPE.md` 2.4 is the rule here — *an app
        * that tells a grower no is an app that is wrong about that grower* —
        * and somebody logging across a date line at midnight is a likelier
        * person than an app that knows better.
        */}
      {dated && at > today ? (
        <Body>
          That day has not happened yet. These buttons record what is already done, and a date in
          the future moves the harvest estimate with it.
        </Body>
      ) : null}

      <View style={styles.actions}>
        {canStartIndoors ? (
          <Secondary
            label="Started them indoors"
            testID="mark-indoors"
            onPress={() => mark({ startedIndoorsAt: at, status: 'started' })}
          />
        ) : null}

        {canSow ? (
          <Secondary
            label="Sowed it"
            testID="mark-sown"
            onPress={() => mark({ sownAt: at, status: 'in-ground' })}
          />
        ) : null}

        {canPlantOut ? (
          <Secondary
            label="Planted it out"
            testID="mark-planted"
            onPress={() => mark({ transplantedAt: at, status: 'in-ground' })}
          />
        ) : null}

        {/**
          * "It is ready — start picking" is gone, and logging a pick is why.
          *
          * Asked directly: *"do we need an 'it is ready - start picking' as a
          * button or a notice? We have a Log a harvest button."* No — and the
          * app already agreed with itself: `HarvestScreen` moves a planting to
          * `harvesting` on the first pick, so the button did by hand what
          * picking does by happening.
          *
          * Two controls that both mean "it is harvest time", one of which
          * records nothing, is a screen asking somebody to tell it a thing it
          * is about to find out. The state is a **notice** now — the panel
          * above says when it is due and when it is ready — and the only
          * button is the one that writes a record.
          */}
      </View>

      <Failure message={failure} />
      <Confirmation message={said} />

      {totals.picks > 0 ? (
        <Panel label="Picked so far">
          <Body>
            {[
              totals.massUg > 0 ? formatMass(totals.massUg, units) : null,
              totals.count > 0 ? `${totals.count} picked` : null,
            ]
              .filter((part): part is string => part !== null)
              .join(' · ')}{' '}
            over {totals.picks} {totals.picks === 1 ? 'pick' : 'picks'}.
          </Body>
        </Panel>
      ) : null}

      <Primary
        label="Log a harvest"
        disabled={saving}
        onPress={() => nav.navigate('Harvest', { plantingId })}
        testID="go-harvest"
      />

      <Notes
        subjectEntity="planting"
        subjectId={plantingId}
        subject={variety?.name ?? 'this planting'}
      />

      <Panel label="When it is over">
        <Body>
          Pulling it out frees the bed and stops this planting producing any more rows. The
          harvests stay — they are how next year's plan gets made.
        </Body>
        <Failure message={pulled.failure} />
        <Confirm
          label="Pull it out"
          armedLabel="Tap again to pull it out"
          onConfirm={() =>
            void pulled.save(async () => {
              await log({
                entity: 'planting',
                op: 'update',
                targetId: plantingId,
                payload: { removedAt: Date.now(), status: 'finished' },
              });
            })
          }
        />
      </Panel>

      {/* Every harvest off this planting, dated. The bed's own story, which
          until now was only ever a total. */}
      <Panel label="This planting">
        <Row
          title="Change what was recorded"
          detail="How many went in, the note, and taking a row back out"
          testID="go-edit-planting"
          onPress={() => nav.navigate('EditPlanting', { plantingId })}
        />
      </Panel>

      <Coming subject={plantingId} here="Planting" />
      <Timeline subject={plantingId} />
    </Screen>
  );
}

/** What has happened to it, in order, in one sentence. */
function describe(planting: { status: string; sownAt?: number; transplantedAt?: number }): string {
  const known = (PLANTING_STATUSES as readonly string[]).includes(planting.status);
  switch (known ? planting.status : 'planned') {
    case 'planned':
      return 'Planned. Nothing is in the ground yet — the dates are waiting on Today.';
    case 'started':
      return 'Started indoors. The planting-out date arrives on Today a week ahead.';
    case 'in-ground':
      return 'In the ground.';
    case 'harvesting':
      return 'Being picked. Log each pick — two people picking the same bed is two records, and both are true.';
    case 'finished':
      return 'Finished and out.';
    case 'failed':
      return 'Failed. Nothing more will be asked about it.';
    default:
      return 'In the ground.';
  }
}

const styles = StyleSheet.create({
  actions: { gap: SPACE.sm },
  when: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  whenLabel: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
