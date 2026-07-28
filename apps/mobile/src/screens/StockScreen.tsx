import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';

/**
 * Stock — the animals you keep.
 *
 * Mixed, not poultry: goats and cattle die, get treated, and get weighed too.
 * `flock` is only the wire name; the UI says herd, drove or gaggle per species.
 */
export function StockScreen(): React.ReactElement {
  return (
    <Screen title="Stock">
      <Panel label="The shell only">
        <Body>
          Groups, head counts, treatments and withdrawal windows land in R4, reading from the
          local projection.
        </Body>
      </Panel>
    </Screen>
  );
}
