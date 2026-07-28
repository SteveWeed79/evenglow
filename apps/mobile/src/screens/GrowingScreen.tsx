import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';

/**
 * Growing — beds, plantings, and the schedule that falls out of a frost date.
 *
 * A first-class tab rather than a section of something else. Crops were cut
 * from the original scope on a competitive argument standing in for a product
 * decision nobody asked for; they are back, and a tab is what "back" means.
 *
 * Nothing is modelled yet. The domain lands after the store and engine are
 * across, so it is built on a queue that has been proven rather than one being
 * written underneath it.
 */
export function GrowingScreen(): React.ReactElement {
  return (
    <Screen title="Growing">
      <Panel label="Not built yet">
        <Body>
          Beds, varieties, sowing windows and harvests. The schedule comes off your last and
          first frost dates, so it works the same whether or not this phone has a signal.
        </Body>
      </Panel>
    </Screen>
  );
}
