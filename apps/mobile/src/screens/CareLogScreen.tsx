import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CARE_KINDS, type CareKind, careIntervalDays, newId } from '@steading/contracts';
import { lastCareBySubject, listCareLogs } from '@steading/core/read/care';
import { listGroups } from '@steading/core/read/groups';
import { Chip, Failure, Field, Primary, TextField, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * "I wormed the goats on Tuesday."
 *
 * The record that clears a husbandry row. `careDues` puts seven jobs per group
 * on Today and every one of them was permanent until this screen existed —
 * there was nothing in the app that could say a job had been done, so the list
 * a farmer reads at 6am had a block of rows on it that no action could
 * shift. That is the precise way a derived list stops being read.
 *
 * Nothing is ticked off here either. Logging the job is what makes the row
 * stop being produced on the next recomputation (due/types.ts, property 3).
 *
 * Deliberately NOT a medication. A wormer with a withdrawal belongs on the
 * treatment screen; this is the lighter record for the jobs with no drug in
 * them — hooves, minerals, a look over — and for the keeper who just wants the
 * interval kept.
 */

const LABELS: Record<CareKind, string> = {
  worming: 'Wormed',
  'hoof-trim': 'Trimmed feet',
  mineral: 'Minerals',
  vaccination: 'Vaccinated',
  'parasite-check': 'Checked for parasites',
  dental: 'Teeth',
  'health-check': 'Looked over',
};

export function CareLogScreen({ route }: ScreenProps<'CareLog'>): React.ReactElement {
  const { groupId } = route.params;
  const nav = useNav();
  const log = useLog();
  const { colors } = useTheme();

  const groups = useLive(listGroups);
  const careLogs = useLive(listCareLogs);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const [kind, setKind] = useState<CareKind | null>(null);
  const [product, setProduct] = useState('');
  const [note, setNote] = useState('');

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  const commit = useCallback(() => {
    if (kind === null) return;
    void save(async () => {
      await log({
        entity: 'careLog',
        op: 'create',
        targetId: newId(),
        payload: {
          occurredAt: Date.now(),
          kind,
          flockId: groupId,
          ...(product.trim() === '' ? {} : { product: product.trim() }),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
      });
    });
  }, [save, log, kind, groupId, product, note]);

  if (groups === null) return <Loading title="Jobs" />;
  if (group === null) return <Missing title="Jobs" what="That group" />;

  const lastDone = careLogs === null ? {} : (lastCareBySubject(careLogs).get(groupId) ?? {});

  /** Only the jobs this species actually has. A chicken has no hooves. */
  const applicable = CARE_KINDS.filter((k) => careIntervalDays(group.species, k) !== null);

  return (
    <Screen title="Log a job done" back>
      <Text style={[styles.label, { color: colors.muted }]}>{group.name}</Text>

      <Field label="What did you do?">
        <View style={styles.chips}>
          {applicable.map((option) => (
            <Chip
              key={option}
              label={LABELS[option]}
              selected={kind === option}
              testID={`care-${option}`}
              onPress={() => setKind(option)}
            />
          ))}
        </View>
      </Field>

      {kind === null ? null : (
        <Panel label="What this clears">
          <Body>
            {describeInterval(lastDone[kind], careIntervalDays(group.species, kind))}
          </Body>
        </Panel>
      )}

      <Field label="What did you use? (optional)" hint="A brand name, if it is worth remembering.">
        <TextField value={product} onChangeText={setProduct} placeholder="Panacur, copper bolus" />
      </Field>

      <Field label="Anything else? (optional)">
        <TextField value={note} onChangeText={setNote} multiline maxLength={500} />
      </Field>

      <Failure message={failure} />

      <Primary
        label="Log it"
        disabled={saving || kind === null}
        onPress={commit}
        testID="save-care"
      />
    </Screen>
  );
}

const DAY_MS = 86_400_000;

/**
 * What logging this actually changes, in a sentence.
 *
 * The interval is the whole feature, so the screen says it rather than making
 * someone infer it from a row disappearing.
 */
function describeInterval(last: number | undefined, days: number | null): string {
  if (days === null) return 'This one is not on a schedule for this kind of animal.';

  const every = `Comes round every ${days} days.`;
  if (last === undefined) {
    return `${every} Nothing recorded yet, which is why it is sitting on Today — logging it now starts the clock.`;
  }

  const since = Math.round((Date.now() - last) / DAY_MS);
  return `${every} Last recorded ${since === 0 ? 'today' : `${since} days ago`}.`;
}

const styles = StyleSheet.create({
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md },
});
