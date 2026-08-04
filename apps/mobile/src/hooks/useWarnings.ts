import { useMemo } from 'react';
import { type Warning, warningsFor } from '@steading/contracts';
import { useDues } from './useDues';
import { useGroups } from './useGroups';
import { useGrowing } from './useGrowing';
import { useWeather } from './useWeather';

/**
 * What the forecast means for this farm, composed from what Today already
 * reads.
 *
 * Four hooks rather than a fifth read, and that is cheap on purpose: every one
 * of them is already mounted on this screen and they all subscribe to the same
 * engine publish, so this adds no query and no round trip. The alternative — a
 * bespoke projection joining groups, beds, plantings and breedings — would be a
 * fifth thing to keep in step with the four that already exist.
 *
 * The rules themselves are in `contracts/warnings.ts`, where they can be tested
 * without a database. This only gathers.
 */
export function useWarnings(): { warnings: Warning[]; loading: boolean } {
  const { weather, loading: weatherLoading } = useWeather();
  const { groups, loading: groupsLoading } = useGroups();
  const { beds, plantings, loading: growingLoading } = useGrowing();
  const { dues, loading: duesLoading } = useDues();

  /**
   * A planting that is in the ground, in a bed with nothing over it.
   *
   * `planned` and `started` are excluded because they are not outside yet —
   * a tray on a windowsill does not care about tonight — and `finished` and
   * `failed` because there is nothing left to lose. That leaves what is
   * actually standing in a bed, which is what the sentence claims.
   */
  const uncoveredPlantings = useMemo(() => {
    const open = new Set(
      beds.filter((bed) => !bed.covered).map((bed) => bed.id),
    );

    return plantings.filter(
      (planting) =>
        open.has(planting.bedId) &&
        (planting.status === 'in-ground' || planting.status === 'harvesting') &&
        planting.removedAt === undefined,
    ).length;
  }, [beds, plantings]);

  const births = useMemo(
    () =>
      dues
        .filter((due) => due.kind === 'birth' && due.at !== null)
        .map((due) => ({ key: due.key, title: due.title, at: due.at ?? 0 })),
    [dues],
  );

  const loading = weatherLoading || groupsLoading || growingLoading || duesLoading;

  const warnings = useMemo(
    () =>
      loading
        ? []
        : warningsFor(
            weather,
            {
              groups: groups.map((group) => ({
                id: group.id,
                name: group.name,
                species: group.species,
                count: group.count,
              })),
              uncoveredPlantings,
              births,
            },
            Date.now(),
          ),
    [loading, weather, groups, uncoveredPlantings, births],
  );

  return { warnings, loading };
}
