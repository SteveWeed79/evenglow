import { StyleSheet, Text, View } from 'react-native';
import { growingSeasonDays } from '@steading/contracts';
import { type Bed, occupants, type Planting } from '@steading/core/read/growing';
import { listVarieties } from '@steading/core/read/growing';
import { Primary } from '../components/Form';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { useGrowing } from '../hooks/useGrowing';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * Growing — beds, and what is in them.
 *
 * A first-class tab rather than a section of something else. Crops were cut
 * from the original scope on a competitive argument standing in for a product
 * decision nobody asked for; they are back, and a tab is what "back" means.
 *
 * Nothing here works before the site has frost dates, so that is what an empty
 * farm is asked for first — not as a settings chore, but because "when does
 * this go in the ground" has no answer without them.
 */
export function GrowingScreen(): React.ReactElement {
  const { site, beds, plantings, loading } = useGrowing();
  const varieties = useLive(listVarieties);
  const { colors } = useTheme();
  const nav = useNav();

  if (loading) return <Screen title="Growing" back>{null}</Screen>;

  // No site: the one thing that must come first, and the reason why.
  if (site === null || site.frost === undefined) {
    return (
      <Screen title="Growing" back>
        <Panel label="First, where are you?">
          <View style={styles.spot}>
          </View>
          <Body>
            Every sowing date is counted from your last spring frost, and every autumn crop is
            counted back from your first. Two dates, once, and the rest of this tab works out
            for itself — offline, for good.
          </Body>
          <Primary
            label="Set your frost dates"
            onPress={() => nav.navigate('SiteSetup')}
            testID="setup-site"
          />
        </Panel>
      </Screen>
    );
  }

  const season = new Date().getFullYear();
  const days = growingSeasonDays(site.frost, season);
  const varietyNames = new Map((varieties ?? []).map((v) => [v.id, v.name]));

  return (
    <Screen title="Growing" back>
      <View style={[styles.season, { backgroundColor: colors.raised, borderColor: colors.border }]}>
        <Text style={[styles.seasonWords, { color: colors.ink }]}>
          {/* The number that decides whether a 120-day melon is possible at all. */}
          {days} days between frosts
          {site.zone ? `, zone ${site.zone.value}` : ''}
        </Text>
      </View>

      {beds.length === 0 ? (
        <Panel label="No beds yet">
          <Body>
            A bed is anywhere you plant — a raised bed, a row, a plot, a tunnel, a block of
            trees. Name them the way you already say them out loud.
          </Body>
        </Panel>
      ) : (
        beds.map((bed) => (
          <BedCard
            key={bed.id}
            bed={bed}
            plantings={occupants(plantings, bed.id)}
            names={varietyNames}
            onPlant={() => nav.navigate('PickVariety', { bedId: bed.id })}
            onOpen={(plantingId) => nav.navigate('Planting', { plantingId })}
          />
        ))
      )}

      <Primary
        label={beds.length === 0 ? 'Add your first bed' : 'Add another bed'}
        onPress={() => nav.navigate('AddBed', { siteId: site.id })}
        testID="add-bed"
      />
    </Screen>
  );
}

function BedCard({
  bed,
  plantings,
  names,
  onPlant,
  onOpen,
}: {
  bed: Bed;
  plantings: Planting[];
  names: Map<string, string>;
  onPlant: () => void;
  onOpen: (plantingId: string) => void;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: colors.raised, borderColor: colors.border }]}>
      <View style={styles.head}>
        <Text style={[styles.bedName, { color: colors.ink }]}>{bed.name}</Text>
        {bed.covered ? (
          <Text style={[styles.label, { color: colors.lanternInk }]}>Covered</Text>
        ) : null}
      </View>

      {/* Occupancy is DERIVED — a planting that went in and has not been
          removed. Nothing stores "what is in this bed", because it would be
          wrong the moment anything was pulled. */}
      {plantings.length === 0 ? (
        <Text style={[styles.empty, { color: colors.muted }]}>Empty</Text>
      ) : (
        plantings.map((p) => (
          <Touch affordance="chevron"
            key={p.id}
            onPress={() => onOpen(p.id)}
            accessibilityRole="button"
            testID={`planting-${p.id}`}
            style={({ pressed }) => [
              styles.planting,
              { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.empty, { color: colors.ink }]}>
              {names.get(p.varietyId) ?? 'A planting'} · {p.status}
            </Text>
            <Icon name="forward" size={20} color={colors.muted} />
          </Touch>
        ))
      )}

      <Touch affordance="border"
        onPress={onPlant}
        accessibilityRole="button"
        testID={`plant-in-${bed.id}`}
        style={({ pressed }) => [
          styles.plant,
          { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.plantLabel, { color: colors.ink }]}>Plant something here</Text>
      </Touch>
    </View>
  );
}

const styles = StyleSheet.create({
  spot: { alignItems: 'center', paddingVertical: SPACE.md },
  season: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  seasonWords: { flex: 1, fontFamily: FONTS.body, fontSize: TYPE.body },
  card: {
    padding: SPACE.lg,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    gap: SPACE.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bedName: { fontFamily: FONTS.display, fontSize: TYPE.title },
  empty: { flex: 1, fontFamily: FONTS.body, fontSize: TYPE.body },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  planting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    minHeight: TAP.min,
    paddingHorizontal: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  plant: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: SPACE.xs,
  },
  plantLabel: { fontFamily: FONTS.body, fontSize: TYPE.body },
});
