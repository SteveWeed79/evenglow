import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  growingSeasonDays,
  newId,
  resolveMonthDay,
  scheduleFor,
  timingOf,
} from '@steading/contracts';
import { type Bed, occupants, type Planting, type Site } from '@steading/core/read/growing';
import { describeLogFailure } from '@steading/core/sync/failure';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { PickVarietyScreen } from './PickVarietyScreen';
import { SiteSetupScreen } from './SiteSetupScreen';
import { useGrowing } from '../hooks/useGrowing';
import { useLog } from '../hooks/useSync';
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
  const { colors } = useTheme();
  const [screen, setScreen] = useState<'list' | 'site' | 'bed'>('list');
  const [planting, setPlanting] = useState<Bed | null>(null);

  if (screen === 'site') return <SiteSetupScreen onDone={() => setScreen('list')} />;
  if (screen === 'bed' && site) {
    return <AddBedScreen siteId={site.id} onDone={() => setScreen('list')} />;
  }
  if (planting && site) {
    return (
      <PickVarietyScreen
        bed={planting}
        site={site}
        onDone={() => setPlanting(null)}
      />
    );
  }
  if (loading) return <Screen title="Growing">{null}</Screen>;

  // No site: the one thing that must come first, and the reason why.
  if (site === null || site.frost === undefined) {
    return (
      <Screen title="Growing">
        <Panel label="First, where are you?">
          <View style={styles.spot}>
            <Icon name="growing" size={56} color={colors.muted} />
          </View>
          <Body>
            Every sowing date is counted from your last spring frost, and every autumn crop is
            counted back from your first. Two dates, once, and the rest of this tab works out
            for itself — offline, for good.
          </Body>
          <Primary label="Set your frost dates" onPress={() => setScreen('site')} testID="setup-site" />
        </Panel>
      </Screen>
    );
  }

  const season = new Date().getFullYear();
  const days = growingSeasonDays(site.frost, season);

  return (
    <Screen title="Growing">
      <View style={[styles.season, { backgroundColor: colors.raised, borderColor: colors.border }]}>
        <Icon name="season" size={24} color={colors.lanternInk} />
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
            onPlant={() => setPlanting(bed)}
          />
        ))
      )}

      <Primary
        label={beds.length === 0 ? 'Add your first bed' : 'Add another bed'}
        onPress={() => setScreen('bed')}
        testID="add-bed"
      />
    </Screen>
  );
}

function BedCard({
  bed,
  plantings,
  onPlant,
}: {
  bed: Bed;
  plantings: Planting[];
  onPlant: () => void;
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
          <Text key={p.id} style={[styles.empty, { color: colors.ink }]}>
            {p.status === 'planned' ? 'Planned' : 'Growing'} · season {p.season}
          </Text>
        ))
      )}

      <Pressable
        onPress={onPlant}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.plant,
          { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Icon name="growing" size={20} color={colors.ink} />
        <Text style={[styles.plantLabel, { color: colors.ink }]}>Plant something here</Text>
      </Pressable>
    </View>
  );
}

function AddBedScreen({ siteId, onDone }: { siteId: string; onDone: () => void }) {
  const log = useLog();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [covered, setCovered] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (saving || name.trim() === '') return;
    setSaving(true);
    try {
      await log({
        entity: 'bed',
        op: 'create',
        targetId: newId(),
        payload: { siteId, name: name.trim(), covered },
      });
    } catch (error) {
      setSaving(false);
      setFailure(describeLogFailure(error));
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDone();
  }, [saving, name, log, siteId, covered, onDone]);

  return (
    <Screen title="Add a bed" back>
      <Text style={[styles.label, { color: colors.muted }]}>What do you call it?</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Bed 3, the top row, the tunnel"
        placeholderTextColor={colors.muted}
        maxLength={80}
        style={[
          styles.field,
          { backgroundColor: colors.raised, borderColor: colors.border, color: colors.ink },
        ]}
      />

      <Pressable
        onPress={() => {
          void Haptics.selectionAsync();
          setCovered((c) => !c);
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: covered }}
        style={({ pressed }) => [
          styles.toggle,
          {
            backgroundColor: covered ? colors.lantern : colors.raised,
            borderColor: covered ? colors.lanternInk : colors.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <Text style={[styles.toggleLabel, { color: covered ? '#241c14' : colors.ink }]}>
          {/* A tunnel beats the site's frost dates, which is why it is worth
              knowing rather than being a note nobody reads. */}
          Under cover (tunnel, frame, cloche)
        </Text>
      </Pressable>

      {failure ? (
        <Panel>
          <Body>{failure}</Body>
        </Panel>
      ) : null}

      <Primary label="Add bed" onPress={() => void save()} disabled={saving || name.trim() === ''} />
    </Screen>
  );
}

export function Primary({
  label,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      {...(testID === undefined ? {} : { testID })}
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: colors.lantern, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

/** Exported so PickVariety can show the same dates this screen computes. */
export function plannedDates(site: Site, timing: ReturnType<typeof timingOf>, season: number) {
  if (site.frost === undefined) return null;
  const schedule = scheduleFor(timing, site.frost, season);
  return { schedule, lastFrost: resolveMonthDay(site.frost.lastSpring, season) };
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
  empty: { fontFamily: FONTS.body, fontSize: TYPE.body },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
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
  field: {
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACE.lg,
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
  },
  toggle: {
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
  },
  toggleLabel: { fontFamily: FONTS.body, fontSize: TYPE.body },
  primary: {
    minHeight: TAP.primary,
    borderRadius: RADII.softHead,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACE.sm,
  },
  primaryLabel: { fontFamily: FONTS.display, fontSize: TYPE.lede, color: '#241c14' },
});
