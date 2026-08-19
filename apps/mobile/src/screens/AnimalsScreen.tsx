import { StyleSheet, Text } from 'react-native';
import { formatMass, SPECIES_TRAITS } from '@homefarm/contracts';
import { inGroup, listAnimals } from '@homefarm/core/read/animals';
import { latestWeightBySubject, listWeights } from '@homefarm/core/read/breeding';
import { listGroups } from '@homefarm/core/read/groups';
import { Primary } from '../components/Form';
import { Loading, Missing } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useUnits } from '../hooks/useUnits';
import type { ScreenProps } from '../navigation/Root';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * The animals inside a group that are known individually.
 *
 * Not every animal needs a record — a pen of forty broilers is a group and
 * stays one. A doe with a name and four kiddings behind her is an individual,
 * and the app takes no view on which is which because the keeper already has
 * one.
 *
 * The forcing function is breeding: a mating names a dam, and a dam is an
 * individual. Without this screen, goats and sheep — the species birthing
 * matters most for — had a due-date engine with nothing to attach it to.
 */
export function AnimalsScreen({ route }: ScreenProps<'Animals'>): React.ReactElement {
  const { groupId } = route.params;
  const nav = useNav();
  const { colors } = useTheme();
  const units = useUnits();

  const groups = useLive(listGroups);
  const animals = useLive(listAnimals);
  const weights = useLive(listWeights);
  const group = groups?.find((g) => g.id === groupId) ?? null;

  if (groups === null) return <Loading title="Animals" />;
  if (group === null) return <Missing title="Animals" what="That group" />;

  const named = inGroup(animals ?? [], groupId);
  const latest = weights === null ? new Map() : latestWeightBySubject(weights);
  const traits = SPECIES_TRAITS[group.species];

  return (
    <Screen title="Named animals" back>
      <Text style={[styles.label, { color: colors.muted }]}>{group.name}</Text>

      {named.length === 0 ? (
        <Panel label="None named yet">
          {/* Empty screens invite (UX-SPEC §6). */}
          <Body>
            Name the ones you know — the doe you breed from, the ram, the hen that goes broody
            every spring. The rest can stay a {traits.collective}.
          </Body>
        </Panel>
      ) : (
        named.map((animal) => {
          const weight = latest.get(animal.id);
          const detail = [
            animal.tag === undefined ? null : `Tag ${animal.tag}`,
            animal.sex === undefined || animal.sex === 'unknown' ? null : animal.sex,
            animal.bornAt === undefined ? null : `born ${new Date(animal.bornAt).getFullYear()}`,
            weight === undefined ? null : formatMass(weight.massUg, units),
          ]
            .filter((part): part is string => part !== null)
            .join(' · ');

          return (
            /**
             * The card opens her now, and until it did this list was the end of
             * the road: a name, a tag and a last weight, with the weights, the
             * worming, the treatments and the matings all recorded against her
             * id and nowhere to read any of it back.
             */
            <Touch
              affordance="chevron"
              key={animal.id}
              accessibilityRole="button"
              testID={`animal-${animal.id}`}
              onPress={() => nav.navigate('Animal', { animalId: animal.id })}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: colors.raised,
                  borderColor: colors.border,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text style={[styles.name, { color: colors.ink }]}>{animal.name}</Text>
              {detail === '' ? null : (
                <Text style={[styles.detail, { color: colors.muted }]}>{detail}</Text>
              )}
            </Touch>
          );
        })
      )}

      <Primary
        label={named.length === 0 ? 'Name an animal' : 'Name another'}
        onPress={() => nav.navigate('AddAnimal', { groupId })}
        testID="add-animal"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: SPACE.lg,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
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
