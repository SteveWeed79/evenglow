import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';

/**
 * Today — the log path, and nothing that competes with it (R1, R2).
 *
 * A placeholder. The tally, the withdrawal banner and the group cards arrive
 * in R4, on top of the store and engine that R2 and R3 port. Deliberately not
 * a transliteration of the web screen: R4 is where the design pass happens.
 */
export function TodayScreen(): React.ReactElement {
  return (
    <Screen title="Today">
      <Panel label="The shell only">
        <Body>
          Navigation, the token set and the icons are in. The tally, the day&rsquo;s totals and
          the withdrawal banner land once the local store and the sync engine are across.
        </Body>
      </Panel>
    </Screen>
  );
}
