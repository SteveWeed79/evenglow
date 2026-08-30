import { createContext, useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { cellWidth, columnsFor } from '../theme/window';
import { LAYOUT, SPACE } from '../theme/tokens';

/**
 * Equivalent things, in as many columns as the room allows.
 *
 * The **feed** canonical layout, and the cheapest thing in
 * `docs/LANDSCAPE-PLAN.md`: no navigation change, no state, no routes. The
 * Farm hub is eight rows in a 600dp column with 600dp of nothing beside it,
 * and eight rows is a grid the moment there is width for one.
 *
 * ## Why the width comes from above
 *
 * `onLayout` would be the obvious source and it reports nothing here: the test
 * suite has no layout engine, so a grid that waited to be measured would
 * render one column in every test and prove nothing about the case it exists
 * for. `Screen` computes the content width from the window and the cap it
 * applied, and hands it down — the same arithmetic the layout engine will do,
 * from the same tokens.
 *
 * The cost is that a `<Grid>` outside a `<Screen>` has no width to divide, so
 * it falls back to one column. That is the right failure: one column is what
 * every phone gets anyway, and it is what this whole component degrades to.
 *
 * ## Why a minimum cell rather than a breakpoint
 *
 * A breakpoint would let the grid disagree with itself — two columns declared
 * at a width where a row's detail line no longer fits. `LAYOUT.cell` is sized
 * for a `Row`: a title with a sentence under it. One column is simply whatever
 * is too narrow for two, so the rule cannot be inconsistent with the thing it
 * is laying out.
 */

/**
 * The width a `Grid` has to divide, in dp.
 *
 * Zero means nobody said, which is the fallback-to-one-column case above.
 */
const ContentWidth = createContext(0);

export const ContentWidthProvider = ContentWidth.Provider;

export function useContentWidth(): number {
  return useContext(ContentWidth);
}

export function Grid({
  children,
  cell = LAYOUT.cell,
  testID,
}: {
  children: React.ReactNode;
  /**
   * The narrowest a cell may be before a column is dropped.
   *
   * Defaults to the `Row` measure. A grid of cards with more in them — Stock's
   * group cards carry two clocks and a breed — can ask for more and get fewer,
   * wider columns rather than a cramped pair.
   */
  cell?: number;
  testID?: string;
}): React.ReactElement {
  const width = useContentWidth();

  /**
   * `null` and `false` are how every screen here writes a conditional row, and
   * a grid that counted them would leave holes in the layout: `{stock ? <Row/>
   * : null}` is one cell on a stock farm and no cell at all on a market
   * garden, not an empty box either way.
   */
  const cells = flatten(children);
  const columns = width > 0 ? Math.min(columnsFor(width, cell), cells.length) : 1;

  /**
   * One column is not a grid, and saying so is not an optimisation.
   *
   * A single-column `flexWrap` row with a computed child width is a different
   * box model from a plain stack — it stops children growing to their content
   * and it double-counts `Screen`'s own gap. Below the threshold this must
   * render exactly what shipped before it existed, so it renders nothing at
   * all and lets the children be the children.
   */
  if (columns < 2) return <>{children}</>;

  const size = cellWidth(width, columns, SPACE.md);

  return (
    <View style={styles.grid} {...(testID === undefined ? {} : { testID })}>
      {cells.map((child, i) => (
        // The index is the key and that is safe here: this wrapper is a
        // position in a layout, not an identity. The child inside it keeps
        // whatever key its own list gave it.
        <View key={i} style={{ width: size }}>
          {child}
        </View>
      ))}
    </View>
  );
}

/**
 * The real children, fragments opened and empties dropped.
 *
 * `React.Children.toArray` would nearly do it — it drops `null` and `false` —
 * but it does not descend into a fragment, and `<>{a}{b}</>` is what a screen
 * writes when two rows belong together. Without this, a fragment holding four
 * rows lays out as one cell four rows tall beside three empty columns.
 */
function flatten(children: React.ReactNode): React.ReactNode[] {
  const out: React.ReactNode[] = [];

  const walk = (node: React.ReactNode): void => {
    if (node === null || node === undefined || node === false || node === true) return;
    if (Array.isArray(node)) return void node.forEach(walk);

    const element = node as { type?: unknown; props?: { children?: React.ReactNode } };
    if (element.type === Symbol.for('react.fragment')) return void walk(element.props?.children);

    out.push(node);
  };

  walk(children);
  return out;
}

const styles = StyleSheet.create({
  /**
   * `gap` rather than margins, and the cell width is computed rather than a
   * percentage, because the two do not compose: `flexBasis: '50%'` already
   * accounts for all the width and the gaps are then extra, so two columns
   * overflow their container by exactly one gap. See `cellWidth`.
   *
   * ## Why a card in here needs `flexGrow: 1` of its own
   *
   * **The cells are already equal height and the cards are not.** `alignItems`
   * defaults to `stretch`, per flex line, so the sizing views above match the
   * tallest cell in their row without being asked — that is why a row of chips
   * elsewhere in the app already comes out level. What breaks the chain here is
   * the wrapper itself: the card inside it is an ordinary block child of a
   * column, so it takes its content's height and leaves the rest of the cell
   * empty under its own border. A group card carrying "Ready to process at
   * 65–87 weeks" therefore stands 60dp taller than the one beside it, and the
   * row reads ragged. Reported off the tablet, on Stock and on The farm.
   *
   * So each card opts in with `flexGrow: 1`, and **`flexGrow` rather than
   * `flex`**: `flex: 1` also sets `flexBasis: 0`, and below the threshold this
   * component returns its children bare into a column of their own height —
   * where a zero basis is measured as no height at all and every card on every
   * phone collapses. `flexGrow` alone does nothing without free space to take,
   * which is exactly the one-column case.
   *
   * It is asked of the card rather than done here because a card is a `Touch`,
   * whose `style` is a function of the pressed state — there is no style for
   * this to merge into from the outside without breaking that.
   */
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md },
});
