import { StyleSheet, Text } from 'react-native';
import { formatMass, SPECIES_TRAITS } from '@steading/contracts';
import { listAnimals } from '@steading/core/read/animals';
import { latestWeightBySubject, listBreedings, listWeights } from '@steading/core/read/breeding';
import { listGroups } from '@steading/core/read/groups';
import { Row } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Coming } from '../components/Coming';
import { Timeline } from '../components/Timeline';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useUnits } from '../hooks/useUnits';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * One animal, and everything the farm has recorded about her.
 *
 * ## The gap this closes
 *
 * A named animal could be created and listed and never opened. The list showed
 * a name, a tag and the last weight; the weights themselves, the worming, the
 * treatments and the matings were all recorded *against her id* and there was
 * nowhere to see any of it. The gap assessment's best single idea was one
 * reusable detail-and-timeline screen for exactly this reason: several entities
 * stop at creation and a static list.
 *
 * Animals are the sharpest case. A doe with four kiddings behind her is the
 * reason individuals exist in this app at all — a mating names a dam — and her
 * record was the one that could not be read back.
 *
 * ## What it shows, in the order somebody asks
 *
 * Who she is, where she lives, what she weighs, and then what happened. The
 * timeline is last because it answers the second question: the top of the
 * screen is for telling her apart from the other three does in the pen.
 *
 * ## Changing her, and putting her away
 *
 * Both live on `EditAnimalScreen`, one row down. They are not here because
 * this screen is read at arm's length in a pen and the two acts that alter a
 * record should take a deliberate turn rather than sit under a thumb.
 *
 * **Putting her away records that she is gone and not why.** §4's adaptable
 * outcome flow — sold, culled, died, moved — is what will ask, and because
 * nothing is deleted (P13) the record is still there for it to attach an
 * answer to. Until then a farm that cannot remove a sold doe keeps her on the
 * list for ever, which is the worse of the two silences.
 */
export function AnimalScreen({ route }: ScreenProps<'Animal'>): React.ReactElement {
  const { animalId } = route.params;
  const nav = useNav();
  const { colors } = useTheme();
  const units = useUnits();

  const animals = useLive(listAnimals);
  const groups = useLive(listGroups);
  const weights = useLive(listWeights);
  const breedings = useLive(listBreedings);

  const animal = animals?.find((a) => a.id === animalId) ?? null;

  if (animals === null) return <Loading title="Animal" />;
  if (animal === null) return <Missing title="Animal" what="That animal" />;

  const group = groups?.find((g) => g.id === animal.flockId) ?? null;
  const weight = weights === null ? undefined : latestWeightBySubject(weights).get(animalId);
  const matings = (breedings ?? []).filter((entry) => entry.damId === animalId);
  const traits = SPECIES_TRAITS[animal.species];

  /**
   * The identifying line: what she is, not what has happened to her.
   *
   * Everything that could be used to pick her out of a pen, in the order
   * somebody would say it out loud, and nothing that is merely absent — a
   * blank "Sex: —" is noise on a screen read at arm's length.
   */
  const identity = [
    animal.breed ?? traits.singular,
    animal.sex === undefined || animal.sex === 'unknown' ? null : animal.sex,
    animal.tag === undefined ? null : `tag ${animal.tag}`,
    animal.bornAt === undefined ? null : `born ${new Date(animal.bornAt).getFullYear()}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <Screen title={animal.name} back>
      <Text style={[styles.identity, { color: colors.muted }]} testID="animal-identity">
        {identity}
      </Text>

      {animal.note === undefined ? null : (
        <Panel label="Noted">
          <Body>{animal.note}</Body>
        </Panel>
      )}

      <Panel label={weight === undefined ? 'Not weighed yet' : 'Last weighed'}>
        {weight === undefined ? (
          <Body>
            Nothing weighed yet. A weight is what turns a growth curve, a dose and a sale price
            from a guess into a number.
          </Body>
        ) : (
          <Text style={[styles.figure, { color: colors.ink }]} testID="animal-weight">
            {formatMass(weight.massUg, units)}
            <Text style={[styles.when, { color: colors.muted }]}>
              {'  '}
              {new Date(weight.occurredAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long',
              })}
            </Text>
          </Text>
        )}
      </Panel>

      {/* Where she lives, and the way back to the rest of them. A named animal
          is always in a group — the contract requires a `flockId` — so this is
          a fact rather than a maybe, and the group is where every action that
          takes a subject already lives. */}
      {group === null ? null : (
        <Panel label="One of">
          <Row
            title={group.name}
            testID="go-group"
            onPress={() => nav.navigate('Group', { groupId: group.id })}
          />
          <Row
            title="Weigh, treat or log a job"
            testID="go-weigh"
            onPress={() => nav.navigate('Weigh', { groupId: group.id })}
          />
        </Panel>
      )}

      <Panel label="Her record">
        <Row
          title={`Change ${animal.name}`}
          detail="Her name, tag, breed, sex and birth"
          testID="go-edit-animal"
          onPress={() => nav.navigate('EditAnimal', { animalId })}
        />
      </Panel>

      {/*
        Matings, when there are any.
        Named rather than counted: "bred 12 March" is what somebody is looking
        for, and a number would send them to another screen to find out which.
        Only for a dam — a `breeding` names one, so a sire has no matings of
        his own to show and an empty panel would imply otherwise.
      */}
      {matings.length === 0 ? null : (
        <Panel label={matings.length === 1 ? 'Bred once' : `Bred ${matings.length} times`}>
          {matings.slice(0, 4).map((mating) => (
            <Row
              key={mating.id}
              title={new Date(mating.bredAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              detail={
                mating.bornAt === undefined
                  ? 'Due, or waiting to be recorded'
                  : `${mating.liveBorn ?? 0} born`
              }
              testID={`mating-${mating.id}`}
              onPress={() => nav.navigate('Breeding', { groupId: animal.flockId })}
            />
          ))}
        </Panel>
      )}

      <Coming subject={animalId} here="Animal" />
      <Timeline subject={animalId} label="What happened to her" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 0.4,
    paddingHorizontal: SPACE.md,
  },
  figure: { fontFamily: FONTS.display, fontSize: TYPE.hero },
  when: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
});
