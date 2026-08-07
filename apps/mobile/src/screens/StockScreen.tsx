import { StyleSheet, Text, View } from 'react-native';
import { formatRange, libraryBreed, SPECIES_TRAITS } from '@steading/contracts';
import type { Group } from '@steading/core/read/groups';
import { Primary } from '../components/Form';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { growOutWindow, layOnsetWindow } from '../hooks/useDues';
import { useGroups } from '../hooks/useGroups';
import { useNav } from '../hooks/useNav';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * Stock — the animals you keep.
 *
 * Mixed, not poultry: `flock` is only the wire name, and the UI says herd,
 * drove or gaggle per species. Nothing on this screen assumes a bird.
 *
 * A card opens the group rather than being the end of the road. Everything a
 * keeper does to a group — treatments, husbandry, weights, produce, feed,
 * losses, matings — lives one tap in, which is what this list was missing.
 */
export function StockScreen(): React.ReactElement {
  const { groups, loading } = useGroups();
  const { colors } = useTheme();
  const nav = useNav();

  if (loading) return <Screen title="Stock" back>{null}</Screen>;

  return (
    <Screen title="Stock" back>
      {groups.length === 0 ? (
        <Panel label="Nothing here yet">
          <View style={styles.spot}>
            <Icon name="stock" size={56} color={colors.muted} />
          </View>
          {/* Empty screens invite (UX-SPEC §6). */}
          <Body>
            Add what you keep and the morning&rsquo;s tally, the withdrawal windows and the
            grow-out clock all follow from it.
          </Body>
        </Panel>
      ) : (
        groups.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            onPress={() => nav.navigate('Group', { groupId: group.id })}
          />
        ))
      )}

      <Primary
        label={groups.length === 0 ? 'Add your first stock' : 'Add another group'}
        onPress={() => nav.navigate('AddGroup')}
        testID="add-group"
      />
    </Screen>
  );
}

function GroupCard({ group, onPress }: { group: Group; onPress: () => void }): React.ReactElement {
  const { colors } = useTheme();
  const traits = SPECIES_TRAITS[group.species];

  /**
   * The two clocks, as ranges rather than dates.
   *
   * The library says six to nine weeks because that is what is true, and a
   * single date would throw away exactly the honesty the range carries. Both
   * are silent unless the group's purpose, birth date and breed all say
   * something — the clock refuses to guess any of them.
   */
  const grow = growOutWindow(group);
  const lay = layOnsetWindow(group);
  const breed = group.breedId === undefined ? undefined : libraryBreed(group.breedId);

  return (
    <Touch affordance="chevron"
      onPress={onPress}
      accessibilityRole="button"
      testID={`group-${group.id}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.raised, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={styles.head}>
        <View style={styles.name}>
          <Text style={[styles.groupName, { color: colors.ink }]}>{group.name}</Text>
          <Text style={[styles.label, { color: colors.muted }]}>
            {/* Herd, drove, gaggle — the species' own word, never "flock". */}
            {traits.label} · {traits.collective}
            {breed ? ` · ${breed.name}` : ''}
          </Text>
        </View>

        <View style={styles.count}>
          <Text style={[styles.countValue, { color: colors.ink }]}>{group.count}</Text>
          <Text style={[styles.label, { color: colors.muted }]}>head</Text>
        </View>
      </View>

      {grow ? (
        <Text style={[styles.clock, { color: colors.muted }]}>
          Ready to process at {formatRange(grow.weeks, 'weeks')} old.
        </Text>
      ) : null}

      {lay ? (
        <Text style={[styles.clock, { color: colors.muted }]}>
          Expect first eggs at {formatRange(lay.weeks, 'weeks')} old.
        </Text>
      ) : null}

      <View style={styles.more}>
        <Text style={[styles.label, { color: colors.lanternInk }]}>Open</Text>
        <Icon name="forward" size={20} color={colors.lanternInk} />
      </View>
    </Touch>
  );
}

const styles = StyleSheet.create({
  spot: { alignItems: 'center', paddingVertical: SPACE.md },
  card: {
    padding: SPACE.lg,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    gap: SPACE.sm,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  name: { flex: 1, gap: 2 },
  count: { alignItems: 'flex-end' },
  groupName: { fontFamily: FONTS.display, fontSize: TYPE.title },
  countValue: { fontFamily: FONTS.display, fontSize: TYPE.title, fontVariant: ['tabular-nums'] },
  label: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  clock: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  more: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, alignSelf: 'flex-end' },
});
