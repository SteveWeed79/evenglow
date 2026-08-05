import { StyleSheet, Text, View } from 'react-native';
import { incubationStage } from '@steading/contracts';
import { listIncubations } from '@steading/core/read/breeding';
import { Primary, Row } from '../components/Form';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * Eggs under, and the two dates that follow.
 *
 * A set of eggs is not a mating with different words — it is a batch with a
 * candling step a third of the way through and a hatch rate at the end, and
 * forcing the two into one shape would leave half the fields meaningless in
 * either case.
 *
 * **Candling is the step that makes this worth recording at all.** Culling
 * clears around day seven frees incubator space for the next set, and a keeper
 * who tracks fertility across sets learns something about their birds that no
 * single hatch tells them. `incubationDues` produces both rows and stops
 * producing each one when its date is filled in — nothing is ticked off.
 */
export function IncubationsScreen(): React.ReactElement {
  const nav = useNav();
  const { colors } = useTheme();

  const incubations = useLive(listIncubations);

  if (incubations === null) return <Screen title="Eggs under">{null}</Screen>;

  const running = incubations.filter((i) => i.hatchedAt === undefined);
  const finished = incubations.filter((i) => i.hatchedAt !== undefined);

  return (
    <Screen title="Eggs under" back>
      {incubations.length === 0 ? (
        <Panel label="Nothing set">
          <View style={styles.spot}>
            <Icon name="egg" size={56} color={colors.muted} />
          </View>
          {/* Empty screens invite (UX-SPEC §6). */}
          <Body>
            Put a date on a set of eggs and the candling day and the hatch day arrive on Today by
            themselves — offline, with nothing to remember.
          </Body>
        </Panel>
      ) : null}

      {running.length > 0 ? (
        <Text style={[styles.heading, { color: colors.muted }]}>Under now</Text>
      ) : null}
      {running.map((incubation) => (
        <Row
          key={incubation.id}
          /**
           * The day count leads, because it is the question.
           *
           * The set date is what a keeper has to do the arithmetic *from*;
           * "day 18 of 21" is the answer they were doing it for. The date
           * stays where the app knows no term for the bird — see
           * `incubationStage`, which refuses to guess one.
           */
          title={incubation.label}
          detail={`${incubation.eggsSet} eggs · ${
            incubationStage(incubation.species, incubation.setAt, Date.now())?.title ??
            `set ${new Date(incubation.setAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
            })}`
          }${incubation.candledAt === undefined ? '' : ' · candled'}`}
          icon="egg"
          onPress={() => nav.navigate('Incubation', { incubationId: incubation.id })}
        />
      ))}

      {finished.length > 0 ? (
        <Text style={[styles.heading, { color: colors.muted }]}>Hatched</Text>
      ) : null}
      {finished.map((incubation) => (
        <Row
          key={incubation.id}
          title={incubation.label}
          detail={`${incubation.hatched ?? 0} of ${incubation.eggsSet} hatched`}
          icon="egg"
          onPress={() => nav.navigate('Incubation', { incubationId: incubation.id })}
        />
      ))}

      <Primary
        label={incubations.length === 0 ? 'Set some eggs' : 'Set another lot'}
        onPress={() => nav.navigate('SetEggs')}
        testID="add-incubation"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  spot: { alignItems: 'center', paddingVertical: SPACE.md },
  heading: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: SPACE.sm,
  },
});
