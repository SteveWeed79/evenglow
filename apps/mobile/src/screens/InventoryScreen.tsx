import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { listInventory, runningLow, type StockItem } from '@homefarm/core/read/iron';
import { Primary, Secondary, Stepper } from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';
import { useTheme } from '../theme/ThemeProvider';
import { useNav } from '../hooks/useNav';
import { useLog } from '../hooks/useSync';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * What is on the shelf.
 *
 * Feed, bedding, medicine and parts in one list, because they are the same
 * question asked about four things: is there enough, and when do I order more.
 * `reorderBelow` is what makes it more than a list — it is the threshold
 * `partsDue` compares against so a service due in a fortnight can say whether
 * the filter is actually in the barn.
 *
 * The quantity is edited in place rather than behind a screen. A count on a
 * shelf is corrected while standing in front of the shelf, and any tap that
 * costs a navigation is a tap that happens later or not at all.
 */
export function InventoryScreen(): React.ReactElement {
  const nav = useNav();
  const items = useLive(listInventory);

  if (items === null) return <Screen title="The shelf">{null}</Screen>;

  const low = runningLow(items);

  return (
    <Screen title="The shelf" back>
      {items.length === 0 ? (
        <Panel label="Nothing tracked">
          {/* Empty screens invite (UX-SPEC §6). */}
          <Body>
            Add the filters and the feed you keep, say what level is too low, and the app will
            tell you to order before a service is waiting on the post.
          </Body>
        </Panel>
      ) : null}

      {low.length > 0 ? (
        <Panel label="Running low">
          <Body>{low.map((item) => item.name).join(', ')}.</Body>
        </Panel>
      ) : null}

      {items.map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}

      <Primary
        label={items.length === 0 ? 'Add something' : 'Add another'}
        onPress={() => nav.navigate('AddItem', {})}
        testID="add-item"
      />
    </Screen>
  );
}

function ItemCard({ item }: { item: StockItem }): React.ReactElement {
  const log = useLog();
  const nav = useNav();
  const { colors } = useTheme();

  const setQuantity = useCallback(
    (quantity: number) => {
      // Fire-and-forget: the enqueue is durable in one transaction, and a
      // stepper that waited on it would feel like a slow button.
      void log({ entity: 'inventory', op: 'update', targetId: item.id, payload: { quantity } });
    },
    [log, item.id],
  );

  const isLow = item.reorderBelow !== undefined && item.quantity <= item.reorderBelow;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isLow ? colors.alertTint : colors.raised,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.name, { color: colors.ink }]}>{item.name}</Text>
      <Text style={[styles.detail, { color: colors.muted }]}>
        {item.kind} · {item.unit}
        {item.reorderBelow === undefined ? '' : ` · order below ${item.reorderBelow}`}
      </Text>

      {/**
        * The stepper corrects the count; the row below records an event.
        *
        * The same line `LossScreen` draws — *the head count stays as you set
        * it, this app does not quietly subtract* — and the reason both exist.
        * A number that was never right is a correction and wants no ceremony.
        * A sack the mice got into is a thing that happened on a day, and it is
        * worth keeping: counted as feed it would quietly inflate the cost of
        * every egg that year.
        */}
      <Stepper value={item.quantity} onChange={setQuantity} steps={[1, 5]} suffix={item.unit} />

      <Secondary
        label="Something happened to it"
        icon="forward"
        onPress={() => nav.navigate('AdjustStock', { itemId: item.id })}
        testID={`adjust-${item.id}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: SPACE.lg,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    gap: SPACE.sm,
  },
  name: { fontFamily: FONTS.display, fontSize: TYPE.title },
  detail: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
});
