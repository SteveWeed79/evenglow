import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BREEDING_METHODS, GESTATION_DAYS, newId } from '@steading/contracts';
import { listAnimals, possibleDams } from '@steading/core/read/animals';
import { listBreedings } from '@steading/core/read/breeding';
import { listGroups } from '@steading/core/read/groups';
import { Choice, Confirm, DayPick, Failure, Field, Primary, Stepper, TextField, useSaver } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * Matings, and the births they turn into.
 *
 * The record exists from the day of the mating rather than from the birth,
 * because the date has to be counted from something six weeks before anyone
 * needs to know it. A record created at birth would be a birth certificate,
 * which is not what a keeper needs while there is still a pen to build.
 *
 * `birthDue` has been tested since the due engine was written and had no
 * record to read. This is that record.
 *
 * **The outcome is filled in later, on the same row.** Live born, stillborn
 * and lost are three separate figures because a keeper deciding whether to
 * breed this animal again needs to know which of them moved — a pregnancy
 * that did not go to term and one that produced nothing living are different
 * events with the same headline number.
 */

const METHOD_LABELS = { natural: 'Ran together', ai: 'AI' } as const;
const DAY_MS = 86_400_000;

export function BreedingScreen({ route }: ScreenProps<'Breeding'>): React.ReactElement {
  const { groupId } = route.params;
  const nav = useNav();
  const log = useLog();
  const { colors } = useTheme();

  const groups = useLive(listGroups);
  const animals = useLive(listAnimals);
  const breedings = useLive(listBreedings);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  const [damId, setDamId] = useState<string | null>(null);
  const [bredAt, setBredAt] = useState(() => startOfDay(Date.now()));
  const [method, setMethod] = useState<(typeof BREEDING_METHODS)[number]>('natural');
  const [sireNote, setSireNote] = useState('');

  const { saving, failure, save } = useSaver(useCallback(() => setDamId(null), []));

  const commit = useCallback(() => {
    if (group === null || damId === null) return;
    void save(async () => {
      await log({
        entity: 'breeding',
        op: 'create',
        targetId: newId(),
        payload: {
          species: group.species,
          damId,
          bredAt,
          method,
          ...(sireNote.trim() === '' ? {} : { sireNote: sireNote.trim() }),
        },
      });
    });
  }, [save, log, group, damId, bredAt, method, sireNote]);

  if (groups === null) return <Loading title="Breeding" />;
  if (group === null) return <Missing title="Breeding" what="That group" />;

  const gestation = GESTATION_DAYS[group.species];
  const dams = possibleDams((animals ?? []).filter((a) => a.flockId === groupId));
  const names = new Map((animals ?? []).map((a) => [a.id, a.name]));
  const mine = (breedings ?? []).filter((b) => names.has(b.damId));

  if (gestation === undefined) {
    return (
      <Screen title="Breeding" back>
        <Panel label="Not this kind of animal">
          <Body>
            {group.name} are birds — eggs go under a hen or into an incubator rather than being
            carried, so the record is a set of eggs and not a mating.
          </Body>
          <Primary label="Eggs under" onPress={() => nav.navigate('Incubations')} />
        </Panel>
      </Screen>
    );
  }

  return (
    <Screen title="Matings" back>
      <Text style={[styles.label, { color: colors.muted }]}>{group.name}</Text>

      {mine.length > 0 ? (
        <View style={styles.list}>
          {mine.map((breeding) => (
            <BreedingCard
              key={breeding.id}
              id={breeding.id}
              name={names.get(breeding.damId) ?? 'One of yours'}
              bredAt={breeding.bredAt}
              bornAt={breeding.bornAt}
              gestation={gestation}
            />
          ))}
        </View>
      ) : null}

      {dams.length === 0 ? (
        <Panel label="Name her first">
          <View style={styles.spot}>
          </View>
          <Body>
            A mating is recorded against one animal, so the dam has to have a name before there
            is anything to record it on.
          </Body>
          <Primary
            label="Name an animal"
            onPress={() => nav.navigate('AddAnimal', { groupId })}
          />
        </Panel>
      ) : (
        <>
          <Field label="Who?">
            <Choice
              options={dams.map((d) => d.id)}
              value={damId ?? ''}
              onChange={setDamId}
              labels={Object.fromEntries(dams.map((d) => [d.id, d.name]))}
            />
          </Field>

          <Field label="When?">
            <DayPick value={bredAt} onChange={setBredAt} withYear />
          </Field>

          <Field label="How?">
            <Choice
              options={BREEDING_METHODS}
              value={method}
              onChange={setMethod}
              labels={METHOD_LABELS}
            />
          </Field>

          <Field
            label="Which sire? (optional)"
            hint="Free text on purpose — a buck borrowed for a fortnight has no record on this farm."
          >
            <TextField value={sireNote} onChangeText={setSireNote} placeholder="Neighbour's buck" maxLength={120} />
          </Field>

          {damId === null ? null : (
            <Panel label="Due">
              <Body>
                About {new Date(bredAt + gestation * DAY_MS).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                , counting {gestation} days. It will appear on Today six weeks before that,
                because building a pen and being around is six weeks of notice, not one.
              </Body>
            </Panel>
          )}

          <Failure message={failure} />

          <Primary
            label="Record the mating"
            disabled={saving || damId === null}
            onPress={commit}
            testID="save-breeding"
          />
        </>
      )}
    </Screen>
  );
}

/**
 * One mating, and the way to close it.
 *
 * The outcome form is on the card rather than behind another push: it is
 * filled in once, standing in a barn at 5am, and every screen between that
 * moment and the record is a screen where it does not get recorded.
 */
function BreedingCard({
  id,
  name,
  bredAt,
  bornAt,
  gestation,
}: {
  id: string;
  name: string;
  bredAt: number;
  bornAt: number | undefined;
  gestation: number;
}): React.ReactElement {
  const log = useLog();
  const { colors } = useTheme();

  const [open, setOpen] = useState(false);
  /**
   * Both start at nothing, which they did not: `stillborn` was 0 and
   * `liveBorn` was 1, so the same form disagreed with itself about whether a
   * default is a fact. Neither is.
   */
  const [liveBorn, setLiveBorn] = useState(0);
  const [stillborn, setStillborn] = useState(0);

  const { saving, failure, save } = useSaver(useCallback(() => setOpen(false), []));

  const record = useCallback(
    (lost: boolean) => {
      void save(async () => {
        await log({
          entity: 'breeding',
          op: 'update',
          targetId: id,
          payload: {
            bornAt: Date.now(),
            ...(lost ? { lost: true, liveBorn: 0 } : { liveBorn, stillborn }),
          },
        });
      });
    },
    [save, log, id, liveBorn, stillborn],
  );

  const due = bredAt + gestation * DAY_MS;

  return (
    <View style={[styles.card, { backgroundColor: colors.raised, borderColor: colors.border }]}>
      <Text style={[styles.name, { color: colors.ink }]}>{name}</Text>
      <Text style={[styles.detail, { color: colors.muted }]}>
        {bornAt === undefined
          ? `Due ${new Date(due).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`
          : `Born ${new Date(bornAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`}
        {' · '}
        mated {new Date(bredAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
      </Text>

      {bornAt !== undefined ? null : open ? (
        <>
          <Field label="Born alive">
            <Stepper value={liveBorn} onChange={setLiveBorn} steps={[1]} />
          </Field>
          <Field label="Stillborn">
            <Stepper value={stillborn} onChange={setStillborn} steps={[1]} />
          </Field>

          <Failure message={failure} />

          <Primary
            label="Record the birth"
            disabled={saving || liveBorn + stillborn === 0}
            onPress={() => record(false)}
            testID={`birth-${id}`}
          />

          {/* Its own action, not a zero. A pregnancy that did not go to term
              is a different event from one that produced nothing living. */}
          <Confirm
            label="It was lost"
            armedLabel="Tap again to record a loss"
            onConfirm={() => record(true)}
          />
        </>
      ) : (
        <Primary label="She has given birth" onPress={() => setOpen(true)} />
      )}
    </View>
  );
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const styles = StyleSheet.create({
  spot: { alignItems: 'center', paddingVertical: SPACE.md },
  list: { gap: SPACE.sm },
  card: {
    padding: SPACE.lg,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    gap: SPACE.sm,
  },
  name: { fontFamily: FONTS.display, fontSize: TYPE.title },
  detail: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
