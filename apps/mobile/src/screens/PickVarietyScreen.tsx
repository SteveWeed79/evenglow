import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  fitsSeason,
  growingSeasonDays,
  hardinessNote,
  hardinessVerdict,
  LIBRARY_VARIETIES,
  type LibraryVariety,
  newId,
  scheduleFor,
  timingOf,
  varietyPayload,
} from '@steading/contracts';
import { listBeds, readSite, type Site } from '@steading/core/read/growing';
import { describeLogFailure } from '@steading/core/sync/failure';
import { Icon } from '../components/Icon';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { useLive2 } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * Picking something to plant, and seeing the dates that fall out of it.
 *
 * This is where the whole growing half becomes visible at once: the bundled
 * library supplies the timing, the site's frost dates supply the anchor, and
 * `scheduleFor` turns "start indoors six weeks before last frost" into a real
 * date. All of it arithmetic, on the device, with the radio off.
 *
 * **Warnings, never blocks.** A variety outside the zone and a crop too slow
 * for the season are both said plainly and both still plantable. A south wall,
 * a cold frame or bought-in transplants beat the map every year, and an app
 * that tells a grower no is an app that is wrong about that grower.
 */
export function PickVarietyScreen({ route }: ScreenProps<'PickVariety'>): React.ReactElement {
  const { bedId } = route.params;
  const log = useLog();
  const nav = useNav();
  const { colors } = useTheme();

  const loaded = useLive2(readSite, listBeds);
  const site = loaded?.[0] ?? null;
  const bed = loaded?.[1].find((b) => b.id === bedId) ?? null;

  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<LibraryVariety | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const season = new Date().getFullYear();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = q === ''
      ? LIBRARY_VARIETIES
      : LIBRARY_VARIETIES.filter(
          (v) => v.name.toLowerCase().includes(q) || v.crop.toLowerCase().includes(q),
        );
    return all.slice(0, 40);
  }, [query]);

  const plant = useCallback(async () => {
    if (saving || chosen === null || bed === null || site === null || site.frost === undefined) {
      return;
    }
    setSaving(true);

    const schedule = scheduleFor(timingOf(chosen), site.frost, season);
    const varietyId = newId();

    try {
      /**
       * The library entry becomes the FARM'S OWN variety record, not a
       * reference to a shared one. That is what makes "your edits always win"
       * work: a later app version can revise the library without silently
       * rewriting anyone's records.
       */
      await log({
        entity: 'variety',
        op: 'create',
        targetId: varietyId,
        payload: varietyPayload(chosen),
      });

      await log({
        entity: 'planting',
        op: 'create',
        targetId: newId(),
        payload: {
          bedId: bed.id,
          varietyId,
          season,
          status: 'planned' as const,
          // Planned and actual side by side. Nothing is sown yet — these are
          // the schedule, and the actual dates get filled in as it happens.
          ...(schedule.startIndoorsAt === null ? {} : { plannedStartIndoorsAt: schedule.startIndoorsAt }),
          ...(schedule.transplantAt === null ? {} : { plannedTransplantAt: schedule.transplantAt }),
          ...(schedule.directSowAt === null && schedule.autumnSowAt === null
            ? {}
            : { plannedSowAt: schedule.directSowAt ?? schedule.autumnSowAt ?? undefined }),
          ...(schedule.firstHarvestAt === null
            ? {}
            : { plannedFirstHarvestAt: schedule.firstHarvestAt }),
        },
      });
    } catch (error) {
      setSaving(false);
      setFailure(describeLogFailure(error));
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    nav.goBack();
  }, [saving, chosen, bed, site, season, log, nav]);

  if (loaded === null) return <Loading title="Plant" />;
  if (bed === null) return <Missing title="Plant" what="That bed" />;
  if (site === null || site.frost === undefined) {
    return <Missing title="Plant" what="Your frost dates — the site this bed belongs to" />;
  }

  if (chosen !== null) {
    return (
      <Screen title={chosen.name} back>
        <Text style={[styles.crop, { color: colors.muted }]}>
          {chosen.crop} · into {bed.name}
        </Text>

        <Plan variety={chosen} site={site} season={season} />

        {failure ? (
          <Panel>
            <Body>{failure}</Body>
          </Panel>
        ) : null}

        <Touch affordance="brass"
          onPress={() => void plant()}
          disabled={saving}
          accessibilityRole="button"
          testID="plant-it"
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: colors.lantern, opacity: saving || pressed ? 0.75 : 1 },
          ]}
        >
          <Text style={[styles.primaryLabel, { color: colors.lanternOn }]}>
            Plan it into {bed.name}
          </Text>
        </Touch>

        <Touch affordance="chevron" onPress={() => setChosen(null)} accessibilityRole="button" style={styles.back}>
          <Text style={[styles.backLabel, { color: colors.muted }]}>Choose something else</Text>
        </Touch>
      </Screen>
    );
  }

  return (
    <Screen title={`Plant in ${bed.name}`} back>
      <View style={styles.search}>
        <Icon name="search" size={24} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Tomato, kale, garlic…"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.field,
            { backgroundColor: colors.raised, borderColor: colors.border, color: colors.ink },
          ]}
        />
      </View>

      {matches.map((variety) => (
        <Touch affordance="check"
          key={variety.id}
          onPress={() => {
            void Haptics.selectionAsync();
            setChosen(variety);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: colors.raised, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <View style={styles.rowWords}>
            <Text style={[styles.rowTitle, { color: colors.ink }]}>{variety.name}</Text>
            <Text style={[styles.rowCrop, { color: colors.muted }]}>
              {variety.crop} · {variety.daysToMaturity} days
            </Text>
          </View>
          <Icon name="forward" size={20} color={colors.muted} />
        </Touch>
      ))}
    </Screen>
  );
}

/**
 * What planting this actually means, in dates.
 *
 * Every line is computed here and now from two numbers the farm supplied. A
 * stage the variety does not have is simply absent rather than shown empty —
 * garlic has no indoor start, and a blank row saying so would be the app
 * inventing a step nobody takes.
 */
function Plan({
  variety,
  site,
  season,
}: {
  variety: LibraryVariety;
  site: Site;
  season: number;
}): React.ReactElement {
  const { colors } = useTheme();
  if (site.frost === undefined) return <></>;

  const schedule = scheduleFor(timingOf(variety), site.frost, season);
  const day = (at: number) =>
    new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

  const rows: [string, number][] = [];
  if (schedule.startIndoorsAt !== null) rows.push(['Start indoors', schedule.startIndoorsAt]);
  if (schedule.transplantAt !== null) rows.push(['Plant out', schedule.transplantAt]);
  if (schedule.directSowAt !== null) rows.push(['Sow direct', schedule.directSowAt]);
  if (schedule.autumnSowAt !== null) rows.push(['Sow in autumn', schedule.autumnSowAt]);
  if (schedule.firstHarvestAt !== null) rows.push(['First pick', schedule.firstHarvestAt]);

  const hardy = hardinessVerdict(
    site.zone ?? null,
    variety.hardyToF === undefined ? null : Math.round(((variety.hardyToF - 32) * 5) / 9 * 10),
  );
  const note = hardinessNote(hardy, variety.name);
  const fits = fitsSeason(variety.daysToMaturity, site.frost, season);

  return (
    <>
      <Panel label="Your dates">
        {rows.map(([label, at]) => (
          <View key={label} style={styles.planRow}>
            <Text style={[styles.planLabel, { color: colors.muted }]}>{label}</Text>
            <Text style={[styles.planDate, { color: colors.ink }]}>{day(at)}</Text>
          </View>
        ))}
      </Panel>

      {/* Both of these warn and neither blocks — see the header. */}
      {!fits ? (
        <Panel label="Tight for your season">
          <Body>
            This wants {variety.daysToMaturity} days and your season is{' '}
            {growingSeasonDays(site.frost, season)} — people beat that with a tunnel or
            bought-in transplants every year.
          </Body>
        </Panel>
      ) : null}

      {note !== null ? (
        <Panel label="Winter">
          <Body>{note}</Body>
        </Panel>
      ) : null}

      {variety.note !== undefined ? (
        <Panel label="Worth knowing">
          <Body>{variety.note}</Body>
        </Panel>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  search: { gap: SPACE.sm },
  field: {
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACE.lg,
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowWords: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: FONTS.body, fontSize: TYPE.body },
  rowCrop: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
  crop: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  planRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE.md },
  planLabel: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.6 },
  planDate: { fontFamily: FONTS.body, fontSize: TYPE.body },
  primary: {
    minHeight: TAP.primary,
    borderRadius: RADII.softHead,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACE.sm,
  },
  primaryLabel: { fontFamily: FONTS.display, fontSize: TYPE.lede },
  back: { minHeight: TAP.min, alignItems: 'center', justifyContent: 'center' },
  backLabel: { fontFamily: FONTS.body, fontSize: TYPE.body },
});
