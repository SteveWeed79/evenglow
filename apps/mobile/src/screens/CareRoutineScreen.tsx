import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  CARE_KINDS,
  type CareIntervals,
  type CareKind,
  careIntervalDays,
} from '@steading/contracts';
import { type Group, listGroups } from '@steading/core/read/groups';
import { Chip, Failure, Field } from '../components/Form';
import { describeLogFailure } from '@steading/core/sync/failure';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { reportTrouble } from '../hooks/useTrouble';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * How often this group's routine jobs come round — and which of them it does
 * at all.
 *
 * ## Why this screen exists
 *
 * `careDues` has taken a per-group `intervals` override since it was written,
 * with `null` documented as "silences a job entirely", and **nothing anywhere
 * set it**. So a farm that buys in vaccinated pullets and never vaccinates
 * again had exactly two options: log a vaccination it never gave, or scroll
 * past that row every morning for the life of the app. An app whose only quiet
 * button is a lie has taught somebody to distrust its own records.
 *
 * The second half is as important and less obvious. The defaults are
 * deliberately conservative — "sooner than most farms need", because an early
 * reminder is dismissed in a tap and a late one is a lame goat — and a keeper
 * who trims every twelve weeks should be able to say twelve rather than
 * dismiss a row every eight. Without that, the honest response to a good
 * default being wrong for you is to stop reading the list.
 *
 * ## Three states, not two
 *
 * **Default**, a number, and **Never**. Default is not the same as storing the
 * current figure: a farm that never expressed a preference should move when
 * the default moves, and a stored copy would freeze it at whatever the app
 * shipped with the day they opened this screen.
 *
 * ## Every job is listed, including the ones this species does not do
 *
 * A chicken has no hooves and the default for `hoof-trim` is "not for this
 * kind of animal" — but it is shown, greyed to Never, because hiding it would
 * make the capability invisible rather than absent. The clearest case is
 * `health-check`: it is off by default everywhere now, and the farm with a
 * group in a rented field two valleys over is exactly who should be able to
 * switch it back on.
 */

/** What the chips offer, in days. `null` is Never; `undefined` is Default. */
const CHOICES: readonly { label: string; days: number | null | undefined }[] = [
  { label: 'Default', days: undefined },
  { label: 'Monthly', days: 30 },
  { label: 'Every 6 weeks', days: 42 },
  { label: 'Quarterly', days: 90 },
  { label: 'Twice a year', days: 182 },
  { label: 'Yearly', days: 365 },
  { label: 'Never', days: null },
];

const TITLES: Record<CareKind, string> = {
  worming: 'Worming',
  'hoof-trim': 'Feet',
  mineral: 'Minerals',
  vaccination: 'Vaccinations',
  'parasite-check': 'Parasite checks',
  dental: 'Teeth',
  'health-check': 'Look-overs',
};

/** What each job is for, in the farm's terms rather than the schema's. */
const NOTES: Record<CareKind, string> = {
  worming: 'A reminder to assess, not a schedule to dose on.',
  'hoof-trim': 'Overgrown feet go lame, and it happens slowly enough to miss.',
  mineral: 'Buckets and licks, and whether they are being taken.',
  vaccination: 'Off, if your stock arrived vaccinated and you do not boost.',
  'parasite-check': 'A faecal count on a ruminant; red mite in the coop for birds.',
  dental: 'Horses and camelids. Nothing else on the list has teeth that need doing.',
  'health-check': 'Off by default — you see them daily. Turn it on for a group you do not.',
};

export function CareRoutineScreen({ route }: ScreenProps<'CareRoutine'>): React.ReactElement {
  const { groupId } = route.params;
  const groups = useLive(listGroups);
  const group = groups?.find((one) => one.id === groupId) ?? null;

  return (
    <Screen title="Routine jobs" back>
      {group === null ? null : <Routine group={group} />}
    </Screen>
  );
}

function Routine({ group }: { group: Group }): React.ReactElement {
  const log = useLog();
  const nav = useNav();
  const { colors } = useTheme();

  /**
   * The draft, seeded once from the record.
   *
   * Held locally and written on each change rather than accumulated behind a
   * Save button: every control here is one tap and its effect is a row
   * appearing or not appearing tomorrow. A form that needed saving would be a
   * second thing to remember for a screen somebody opens twice a year.
   */
  const [draft, setDraft] = useState<CareIntervals>(group.careIntervals ?? {});
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Written on each change, and deliberately NOT through `useSaver`.
   *
   * `useSaver` is built for a form that submits once and navigates away: it
   * never lowers `saving` on success, because the screen is expected to be
   * gone. This screen stays put and saves many times, so the second tap and
   * every tap after it would have been dropped by that guard — which a test
   * caught doing exactly that, leaving "Never" stored after "Default" was
   * pressed.
   */
  const set = useCallback(
    (kind: CareKind, days: number | null | undefined) => {
      // `undefined` means "no opinion" and must be absent from the record
      // rather than stored as a null — see `careIntervals` in the contract.
      const next: CareIntervals = { ...draft };
      if (days === undefined) delete next[kind];
      else next[kind] = days;

      setDraft(next);
      setFailure(null);

      void log({
        entity: 'flock',
        op: 'update',
        targetId: group.id,
        // Sent whole rather than as a patch: the projection merges one level
        // deep, so this replaces the map outright and a removed kind is
        // genuinely removed.
        payload: { careIntervals: next },
      }).catch((error: unknown) => {
        // The draft is left as the farm set it. Reverting would move a chip
        // back under somebody's thumb, and the queue is the plan — this only
        // needs saying when the write could not even be queued.
        setFailure(describeLogFailure(error));
        reportTrouble('changing how often that asks', error);
      });
    },
    [draft, log, group.id],
  );

  const rows = useMemo(
    () =>
      CARE_KINDS.map((kind) => ({
        kind,
        /** What the app would do if the farm said nothing. */
        fallback: careIntervalDays(group.species, kind),
        chosen: draft[kind],
      })),
    [group.species, draft],
  );

  return (
    <>
      <Panel label={group.name}>
        <Body>
          These decide what appears on Today. Turn one off and it stops asking — nothing you
          have already logged goes anywhere, and you can still record the job by hand.
        </Body>
      </Panel>

      {rows.map((row) => (
        <Field key={row.kind} label={TITLES[row.kind]} hint={NOTES[row.kind]}>
          <Text style={[styles.current, { color: colors.muted }]} testID={`care-now-${row.kind}`}>
            {describe(row.chosen, row.fallback)}
          </Text>

          <View style={styles.chips}>
            {CHOICES.map((choice) => (
              <Chip
                key={choice.label}
                label={choice.label}
                // Compared with `Object.is` so the three states stay three:
                // `undefined` (default) and `null` (never) are not the same
                // answer and must not select the same chip.
                selected={Object.is(row.chosen, choice.days)}
                testID={`care-${row.kind}-${choice.label.toLowerCase().replace(/\s+/g, '-')}`}
                onPress={() => set(row.kind, choice.days)}
              />
            ))}
          </View>
        </Field>
      ))}

      <Failure message={failure} />

      <Text
        style={[styles.footnote, { color: colors.muted }]}
        onPress={() => nav.goBack()}
      >
        Changes are kept as you make them.
      </Text>
    </>
  );
}

/** What is actually happening now, said in one line. */
function describe(chosen: number | null | undefined, fallback: number | null): string {
  if (chosen === null) return 'Never asks';
  if (chosen !== undefined) return `Every ${chosen} days`;
  if (fallback === null) return 'Not for this kind of animal';
  return `Every ${fallback} days, by default`;
}

const styles = StyleSheet.create({
  current: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  footnote: { fontFamily: FONTS.body, fontSize: TYPE.label, marginTop: SPACE.md },
});
