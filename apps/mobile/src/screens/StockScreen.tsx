import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatRange, libraryBreed, SPECIES_TRAITS } from '@steading/contracts';
import type { Group } from '@steading/core/read/groups';
import { groupPhrase } from '@steading/core/voice';
import { Primary } from '../components/Form';
import { Grid } from '../components/Grid';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { PaneTitle, Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { growOutWindow, layOnsetWindow } from '../hooks/useDues';
import { useGroups } from '../hooks/useGroups';
import { useTheme } from '../theme/ThemeProvider';
import { useNav } from '../hooks/useNav';
import { useWindow } from '../hooks/useWindow';
import { GroupBody } from './GroupScreen';
import { FONTS, LAYOUT, RADII, SPACE, TYPE } from '../theme/tokens';

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
  const nav = useNav();
  const { panes } = useWindow();
  const [chosen, setChosen] = useState<string | null>(null);

  if (loading) return <Screen title="Stock" back>{null}</Screen>;

  /**
   * List-detail, on the same terms as Iron and History.
   *
   * The group hub opens beside the list rather than over it, and the pushed
   * route is untouched — a phone navigates exactly as it did. `GroupScreen`
   * was split by taking its `<Screen>` wrapper off, so the pane and the pushed
   * screen are one component: there is no second group hub to keep in step,
   * and no second place for a withdrawal banner to go missing.
   *
   * The first group selects itself, because a detail pane that opens empty is
   * half a screen of nothing.
   */
  const split = panes === 2 && groups.length > 0;
  const open = split ? (groups.find((g) => g.id === chosen) ?? groups[0] ?? null) : null;

  return (
    <Screen
      title="Stock"
      back
      wide
      {...(open === null
        ? {}
        : {
            aside: (
              <>
                <PaneTitle>{open.name}</PaneTitle>
                <GroupBody group={open} />
              </>
            ),
          })}
    >
      {groups.length === 0 ? (
        <Panel label="Nothing here yet">
          {/* Empty screens invite (UX-SPEC §6). */}
          <Body>
            Add what you keep and the morning&rsquo;s tally, the withdrawal windows and the
            grow-out clock all follow from it.
          </Body>
        </Panel>
      ) : (
        <Grid cell={LAYOUT.column / 2} testID="stock-grid">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              // Beside a pane a card selects; without one it navigates.
              onPress={() =>
                split ? setChosen(group.id) : nav.navigate('Group', { groupId: group.id })
              }
            />
          ))}
        </Grid>
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
          {/* Said rather than printed — see GroupScreen for the argument.

              The count is passed and not shown: it has its own column to the
              right, at display size, because on a list it is the thing being
              compared between cards. It is still needed here, because it
              decides whether the sentence is about a herd at all — a card that
              did not pass it read "A herd of Angus cattle." beside a 1. */}
          <Text style={[styles.lede, { color: colors.inkQuiet }]}>
            {groupPhrase({
              collective: traits.collective,
              ...(group.species === 'other'
                ? {}
                : { species: traits.label.toLowerCase(), singular: traits.singular }),
              count: group.count,
              showCount: false,
              ...(breed === undefined ? {} : { breed: breed.name }),
            })}
          </Text>
        </View>

        <View style={styles.count}>
          <Text style={[styles.countValue, { color: colors.ink }]}>{group.count}</Text>
          <Text style={[styles.label, { color: colors.muted }]}>head</Text>
        </View>
      </View>

      {grow ? (
        <Text style={[styles.clock, { color: colors.inkQuiet }]}>
          Ready to process at {formatRange(grow.weeks, 'weeks')} old.
        </Text>
      ) : null}

      {lay ? (
        <Text style={[styles.clock, { color: colors.inkQuiet }]}>
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
  // `label` stays for "head" and "Open" — a unit and a control, which is what
  // the data face is actually for.
  lede: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  clock: { fontFamily: FONTS.body, fontSize: TYPE.body, lineHeight: TYPE.body * 1.35 },
  more: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, alignSelf: 'flex-end' },
});
