import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';

/**
 * More — everything else.
 *
 * The weakest of the four tabs, and knowingly so: it is a drawer rather than a
 * place you go. Growing has no home in this bar yet, and this is the tab that
 * should give way when it gets one.
 */
export function MoreScreen(): React.ReactElement {
  return (
    <Screen title="More">
      <Panel label="The shell only">
        <Body>
          Sync diagnostics, the rejected inbox, export and sign-out land with the engine in R3
          and auth in R5.
        </Body>
      </Panel>
    </Screen>
  );
}
