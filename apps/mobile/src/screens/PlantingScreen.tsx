import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMass, PLANTING_STATUSES } from '@steading/contracts';
import {
  harvestTotals,
  listBeds,
  listHarvests,
  listPlantings,
  listVarieties,
} from '@steading/core/read/growing';
import { Confirm, Failure, Primary, Secondary, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Notes } from '../components/Notes';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
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
 */
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

  const { saving, failure, save } = useSaver(useCallback(() => undefined, []));
  const pulled = useSaver(useCallback(() => nav.goBack(), [nav]));

  const mark = useCallback(
    (payload: Record<string, unknown>) => {
      void save(async () => {
        await log({ entity: 'planting', op: 'update', targetId: plantingId, payload });
      });
    },
    [save, log, plantingId],
  );

  if (plantings === null) return <Loading title="Planting" />;
  if (planting === null) return <Missing title="Planting" what="That planting" />;

  const variety = varieties?.find((v) => v.id === planting.varietyId);
  const bed = beds?.find((b) => b.id === planting.bedId);
  const totals = harvestTotals(harvests ?? [], plantingId);

  const started = planting.startedIndoorsAt !== undefined;
  const needsIndoorStart = planting.plannedStartIndoorsAt !== undefined;

  return (
    <Screen title={variety?.name ?? 'A planting'} back>
      <Text style={[styles.label, { color: colors.muted }]}>
        {variety?.crop ?? 'Growing'} · {bed?.name ?? 'a bed'} · season {planting.season}
      </Text>

      <Panel label="Where it is">
        <Body>{describe(planting)}</Body>
      </Panel>

      <View style={styles.actions}>
        {needsIndoorStart && !started ? (
          <Secondary
            label="Started them indoors"
            testID="mark-indoors"
            onPress={() => mark({ startedIndoorsAt: Date.now(), status: 'started' })}
          />
        ) : null}

        {planting.sownAt === undefined && !needsIndoorStart ? (
          <Secondary
            label="Sowed it"
            testID="mark-sown"
            onPress={() => mark({ sownAt: Date.now(), status: 'in-ground' })}
          />
        ) : null}

        {/* Gated on the indoor start for the same reason the due builder is. */}
        {planting.transplantedAt === undefined && (!needsIndoorStart || started) ? (
          <Secondary
            label="Planted it out"
            testID="mark-planted"
            onPress={() => mark({ transplantedAt: Date.now(), status: 'in-ground' })}
          />
        ) : null}

        {planting.status !== 'harvesting' && planting.status !== 'finished' ? (
          <Secondary
            label="It is ready — start picking"
            testID="mark-harvesting"
            onPress={() => mark({ status: 'harvesting' })}
          />
        ) : null}
      </View>

      <Failure message={failure} />

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
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
