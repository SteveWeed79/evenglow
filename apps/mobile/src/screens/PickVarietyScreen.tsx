import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  fahrenheitToDeciC,
  fitsSeason,
  growingSeasonDays,
  hardinessNote,
  hardinessVerdict,
  LIBRARY_VARIETIES,
  type LibraryVariety,
  newId,
  type PlantingWindow,
  nextWindow,
  scheduleFor,
  timingOf,
  timingOfRecord,
  varietyPayload,
  type VarietyTiming,
  WINDOW_WORDS,
} from '@steading/contracts';
import {
  listBeds,
  listVarieties,
  readSite,
  type Site,
  type Variety,
} from '@steading/core/read/growing';
import { describeLogFailure } from '@steading/core/sync/failure';
import { Secondary } from '../components/Form';
import { Icon } from '../components/Icon';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { useLive, useLive2 } from '../hooks/useLive';
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
 *
 * ## Three ways in, in the order a grower asks
 *
 * Reported from a farm: the planting setup is not user friendly. The screen
 * opened on the entire library alphabetically — a hundred and ninety-three crop
 * headings, tomatoes near the bottom — and offered no way at all to reach a
 * variety the farm had added itself. So it now leads with the two questions
 * that have short answers:
 *
 * 1. **What you already grow.** A farm plants roughly the same fifteen things
 *    every year, and in the second season those are one tap from the top
 *    instead of a scroll away. It is also the only route back to a variety
 *    somebody added themselves, which the library by definition does not hold.
 * 2. **What can go in now**, from the frost dates the site already carries.
 * 3. **Everything**, unchanged and still there, because the two above are
 *    shortcuts and a shortcut that hides the road is a worse screen.
 */
export function PickVarietyScreen({ route }: ScreenProps<'PickVariety'>): React.ReactElement {
  const { bedId } = route.params;
  const log = useLog();
  const nav = useNav();
  const { colors } = useTheme();

  const loaded = useLive2(readSite, listBeds);
  const site = loaded?.[0] ?? null;
  const bed = loaded?.[1].find((b) => b.id === bedId) ?? null;
  const mine = useLive(listVarieties);

  const [query, setQuery] = useState('');

  /**
   * Crops open one at a time, rather than every variety at once.
   *
   * Grouping put the crop above its varieties and left all of them on screen,
   * so the list was still the whole library with headings in it. Reported as
   * wanting the crop to collapse and the variety hidden — *"collapse parsley
   * and hide Italian flat leaf"* — which is how the decision is actually made:
   * you know you are planting parsley before you know which parsley.
   *
   * Searching overrides it. Somebody who typed "flat leaf" has named a variety
   * rather than a crop, and answering that with a closed row saying Parsley
   * would be the app pretending not to have heard.
   *
   * Keyed by section as well as crop, because the same crop can stand in both
   * the seasonal shortcut and the full list, and opening it in one place must
   * not silently unfold it somewhere else on the same screen.
   */
  const [opened, setOpened] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const season = new Date().getFullYear();
  /**
   * Read once for the life of the screen. A window that recomputed on every
   * keystroke would be doing the same arithmetic a hundred and ninety-three
   * times for an answer that changes once a day.
   */
  const [today] = useState(() => Date.now());

  const q = query.trim().toLowerCase();

  /**
   * Crops, each with its varieties under it.
   *
   * **The list used to be neither sorted nor grouped**, and the row put the
   * variety in the title with the crop underneath — so it read Roma first and
   * Tomato second, which is backwards from how anybody decides what to plant.
   * Reported as *"our plant sorting is incorrect, it should be Tomatoes >
   * Roma"*, and it is: you know you are planting tomatoes before you know
   * which.
   *
   * It was also `LIBRARY_VARIETIES` in declaration order sliced to forty, so a
   * search for nothing showed whichever forty the file happened to open with
   * and said nothing about the rest.
   *
   * Grouping is by `crop`, not `family`. They are different fields and only
   * one of them is a word a grower uses: `family` is botanical — `solanaceae`
   * covers tomatoes, potatoes, peppers and aubergines together — and it is
   * load-bearing for `rotationConflict`, which is a different question from
   * what to plant today.
   */
  const groups = useMemo(() => {
    const all =
      q === ''
        ? LIBRARY_VARIETIES
        : LIBRARY_VARIETIES.filter(
            (v) => v.name.toLowerCase().includes(q) || v.crop.toLowerCase().includes(q),
          );

    return byCrop(all, (v) => v.crop).map(({ crop, varieties }) => ({
      crop,
      varieties: varieties.map(fromLibrary),
    }));
  }, [q]);

  /**
   * The handful whose moment is now, nearest first.
   *
   * A crop appears if any of its varieties has a window, and carries the
   * nearest of them — an early and a late tomato are the same decision to
   * somebody looking for tomatoes, and splitting them into two headings would
   * put the crop back in the list twice.
   */
  const ready = useMemo(() => {
    const frost = site?.frost;
    if (frost === undefined) return [];

    const windows = new Map<string, PlantingWindow>();
    const open = LIBRARY_VARIETIES.filter((v) => {
      const window = nextWindow(timingOf(v), frost, season, today);
      if (window === null) return false;
      const held = windows.get(v.crop);
      if (held === undefined || Math.abs(window.at - today) < Math.abs(held.at - today)) {
        windows.set(v.crop, window);
      }
      return true;
    });

    return byCrop(open, (v) => v.crop)
      .flatMap(({ crop, varieties }) => {
        const window = windows.get(crop);
        return window === undefined
          ? []
          : [{ crop, window, varieties: varieties.map(fromLibrary) }];
      })
      .sort((a, b) => a.window.at - b.window.at || a.crop.localeCompare(b.crop));
  }, [site, season, today]);

  /**
   * What this farm already has, one row per variety and one row only.
   *
   * Deduplicated on crop and name because until this screen learned to reuse a
   * record, every planting minted a fresh one — a farm that put Sungold in
   * three beds has three Sungolds, and listing all three would show the bug
   * rather than repair it. The oldest wins, so the id that the earlier
   * plantings already point at is the one that keeps being used.
   */
  const grown = useMemo(() => {
    const seen = new Set<string>();
    const kept: Choice[] = [];

    for (const variety of mine ?? []) {
      const key = `${variety.crop.toLowerCase()}|${variety.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      if (q !== '' && !variety.name.toLowerCase().includes(q) && !variety.crop.toLowerCase().includes(q)) {
        continue;
      }
      seen.add(key);
      kept.push(fromRecord(variety));
    }

    return kept;
  }, [mine, q]);

  const plant = useCallback(async () => {
    if (saving || chosen === null || bed === null || site === null || site.frost === undefined) {
      return;
    }
    setSaving(true);

    const schedule = scheduleFor(chosen.timing, site.frost, season);

    try {
      /**
       * A library pick becomes the FARM'S OWN variety record, not a reference
       * to a shared one. That is what makes "your edits always win" work: a
       * later app version can revise the library without silently rewriting
       * anyone's records.
       *
       * A variety the farm already holds is reused rather than copied again.
       * It was copied every time until now, so planting Sungold in three beds
       * left three Sungolds — which is a farm's own edit to the days-to-
       * maturity landing on one of them and being contradicted by the other
       * two on the next screen that reads them.
       */
      let varietyId = chosen.varietyId;
      if (varietyId === null) {
        if (chosen.entry === null) {
          setSaving(false);
          return;
        }
        varietyId = newId();
        await log({
          entity: 'variety',
          op: 'create',
          targetId: varietyId,
          payload: varietyPayload(chosen.entry),
        });
      }

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

        <Plan choice={chosen} site={site} season={season} />

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

  /** Searching opens everything: a typed variety name must not stay hidden. */
  const isOpen = (section: string, crop: string): boolean =>
    q !== '' || opened === `${section}:${crop}`;

  const toggle = (section: string, crop: string): void => {
    void Haptics.selectionAsync();
    const key = `${section}:${crop}`;
    setOpened((was) => (was === key ? null : key));
  };

  const crops = (
    section: string,
    list: { crop: string; varieties: Choice[]; window?: PlantingWindow }[],
  ): React.ReactElement[] =>
    list.map(({ crop, varieties, window }) => (
      <View key={crop} style={styles.group}>
        <Touch affordance="chevron"
          onPress={() => toggle(section, crop)}
          accessibilityRole="button"
          accessibilityLabel={`${crop}, ${varieties.length} to choose from`}
          testID={`${section}-${crop}`}
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: colors.raised, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <View style={styles.rowWords}>
            <Text style={[styles.rowTitle, { color: colors.ink }]}>{crop}</Text>
            <Text style={[styles.rowCrop, { color: colors.muted }]}>
              {window === undefined
                ? `${varieties.length} ${varieties.length === 1 ? 'kind' : 'kinds'}`
                : windowWords(window)}
            </Text>
          </View>
          <Icon name={isOpen(section, crop) ? 'check' : 'forward'} size={20} color={colors.muted} />
        </Touch>

        {!isOpen(section, crop)
          ? null
          : varieties.map((variety) => (
              <VarietyRow
                key={`${variety.varietyId ?? ''}${variety.crop}${variety.name}`}
                choice={variety}
                nested
                onPress={() => setChosen(variety)}
              />
            ))}
      </View>
    ));

  return (
    <Screen title={`Plant in ${bed.name}`} back>
      <View style={styles.search}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Tomato, kale, garlic…"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          testID="variety-search"
          style={[
            styles.field,
            { backgroundColor: colors.raised, borderColor: colors.border, color: colors.ink },
          ]}
        />
      </View>

      {/* Varieties rather than crops, because these are already the answer:
          somebody who grew Sungold last year is not being asked which tomato. */}
      {grown.length === 0 ? null : (
        <View style={styles.section}>
          <Text style={[styles.sectionWords, { color: colors.muted }]}>You already grow</Text>
          {grown.map((variety) => (
            <VarietyRow
              key={variety.varietyId ?? variety.name}
              choice={variety}
              showCrop
              testID={`mine-${variety.name}`}
              onPress={() => setChosen(variety)}
            />
          ))}
        </View>
      )}

      {/* Only when nothing has been typed. A search is a direct question and
          the full list below answers it; repeating four of its rows above
          under a seasonal heading would just be the same crop twice. */}
      {q !== '' || ready.length === 0 ? null : (
        <View style={styles.section}>
          <Text style={[styles.sectionWords, { color: colors.muted }]}>Ready to go in now</Text>
          {crops('now', ready)}
        </View>
      )}

      <View style={styles.section}>
        {/* The heading earns its place only when there is something above it
            to be "else" from. */}
        {grown.length === 0 && (q !== '' || ready.length === 0) ? null : (
          <Text style={[styles.sectionWords, { color: colors.muted }]}>Everything else</Text>
        )}
        {crops('crop', groups)}
      </View>

      {/**
        * The way out of a list that cannot be complete.
        *
        * Sixty varieties against thousands, and the first real morning of use
        * found one it did not have — *"my wife just planted Black Pumpkins"*,
        * a search with no result and no next step over a seed already in the
        * ground. `DOMAIN-SCOPE.md` 2.4 settles what happens then: an app that
        * tells a grower no is an app that is wrong about that grower.
        *
        * At the end rather than only on an empty search, because somebody who
        * can see six near-misses still knows theirs is not among them, and
        * making them clear the box to be offered the answer is a puzzle rather
        * than a screen. The crop they typed comes with them.
        */}
      <Secondary
        label={query.trim() === '' ? 'Add one of your own' : `Add "${query.trim()}" yourself`}
        testID="add-variety"
        onPress={() =>
          nav.navigate('AddVariety', {
            bedId,
            ...(query.trim() === '' ? {} : { crop: query.trim() }),
          })
        }
      />
    </Screen>
  );
}

/**
 * One thing that can be planted, from either source.
 *
 * The two sources genuinely differ — a library entry is a bundled constant in
 * Fahrenheit and inches, a farm's record is a synced entity in the canonical
 * units — and the screen below wants neither of those distinctions. So they are
 * flattened once, here, and `varietyId` carries the only difference that
 * survives it: whether a record already exists to plant against.
 */
interface Choice {
  /** The farm's record, or null when planting this mints one. */
  varietyId: string | null;
  name: string;
  crop: string;
  timing: VarietyTiming;
  daysToMaturity: number | undefined;
  hardyToDeciC: number | undefined;
  note: string | undefined;
  /** The library entry to copy, when there is no record yet. */
  entry: LibraryVariety | null;
}

function fromLibrary(entry: LibraryVariety): Choice {
  return {
    varietyId: null,
    name: entry.name,
    crop: entry.crop,
    timing: timingOf(entry),
    daysToMaturity: entry.daysToMaturity,
    hardyToDeciC: entry.hardyToF === undefined ? undefined : fahrenheitToDeciC(entry.hardyToF),
    note: entry.note,
    entry,
  };
}

function fromRecord(variety: Variety): Choice {
  return {
    varietyId: variety.id,
    name: variety.name,
    crop: variety.crop,
    timing: timingOfRecord(variety),
    daysToMaturity: variety.daysToMaturity,
    hardyToDeciC: variety.hardyToDeciC,
    note: variety.note,
    entry: null,
  };
}

/** Crop headings with their varieties under them, both alphabetical. */
function byCrop<T>(
  all: readonly T[],
  crop: (item: T) => string,
): { crop: string; varieties: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of all) {
    const key = crop(item);
    const found = map.get(key);
    if (found === undefined) map.set(key, [item]);
    else found.push(item);
  }

  return [...map.entries()]
    .map(([name, varieties]) => ({ crop: name, varieties }))
    .sort((a, b) => a.crop.localeCompare(b.crop));
}

/** "Sow now", or "Sow from 3 June" for one that has not come round yet. */
function windowWords(window: PlantingWindow): string {
  const verb = WINDOW_WORDS[window.kind];
  if (window.open) return `${verb} now`;
  const day = new Date(window.at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
  return `${verb} from ${day}`;
}

function VarietyRow({
  choice,
  nested = false,
  showCrop = false,
  testID,
  onPress,
}: {
  choice: Choice;
  nested?: boolean;
  /** For a flat list, where the crop is not already the heading above. */
  showCrop?: boolean;
  testID?: string;
  onPress: () => void;
}): React.ReactElement {
  const { colors } = useTheme();

  const days = choice.daysToMaturity === undefined ? null : `${choice.daysToMaturity} days`;
  const under = showCrop ? [choice.crop, days].filter((s) => s !== null).join(' · ') : days;

  return (
    <Touch affordance="check"
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      {...(testID === undefined ? {} : { testID })}
      style={({ pressed }) => [
        styles.row,
        nested ? styles.nested : null,
        { backgroundColor: colors.raised, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View style={styles.rowWords}>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{choice.name}</Text>
        {/* The crop is the heading above in the grouped lists, so the line
            under a variety is what distinguishes it from its siblings rather
            than what it already has in common with them. */}
        {under === null || under === '' ? null : (
          <Text style={[styles.rowCrop, { color: colors.muted }]}>{under}</Text>
        )}
      </View>
      <Icon name="forward" size={20} color={colors.muted} />
    </Touch>
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
  choice,
  site,
  season,
}: {
  choice: Choice;
  site: Site;
  season: number;
}): React.ReactElement {
  const { colors } = useTheme();
  if (site.frost === undefined) return <></>;

  const schedule = scheduleFor(choice.timing, site.frost, season);
  const day = (at: number) =>
    new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

  const rows: [string, number][] = [];
  if (schedule.startIndoorsAt !== null) rows.push(['Start indoors', schedule.startIndoorsAt]);
  if (schedule.transplantAt !== null) rows.push(['Plant out', schedule.transplantAt]);
  if (schedule.directSowAt !== null) rows.push(['Sow direct', schedule.directSowAt]);
  if (schedule.autumnSowAt !== null) rows.push(['Sow in autumn', schedule.autumnSowAt]);
  if (schedule.firstHarvestAt !== null) rows.push(['First pick', schedule.firstHarvestAt]);

  const hardy = hardinessVerdict(site.zone ?? null, choice.hardyToDeciC ?? null);
  const note = hardinessNote(hardy, choice.name);
  // A farm's own addition may have no days to maturity, and a season it cannot
  // be measured against is one this must say nothing about rather than guess.
  const fits =
    choice.daysToMaturity === undefined
      ? true
      : fitsSeason(choice.daysToMaturity, site.frost, season);

  return (
    <>
      {/* A variety with no timing at all — somebody's own addition, saved
          before they knew the numbers — produces no rows, and an empty panel
          headed "Your dates" is the app promising something it does not have. */}
      {rows.length === 0 ? null : (
        <Panel label="Your dates">
          {rows.map(([label, at]) => (
            <View key={label} style={styles.planRow}>
              <Text style={[styles.planLabel, { color: colors.muted }]}>{label}</Text>
              <Text style={[styles.planDate, { color: colors.ink }]}>{day(at)}</Text>
            </View>
          ))}
        </Panel>
      )}

      {/* Both of these warn and neither blocks — see the header. */}
      {!fits ? (
        <Panel label="Tight for your season">
          <Body>
            This wants {choice.daysToMaturity} days and your season is{' '}
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

      {choice.note !== undefined ? (
        <Panel label="Worth knowing">
          <Body>{choice.note}</Body>
        </Panel>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  search: { gap: SPACE.sm },
  group: { gap: SPACE.sm },
  section: { gap: SPACE.sm },
  nested: { marginLeft: SPACE.lg },
  sectionWords: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: SPACE.xs,
  },
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
