import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';

/**
 * Settings — reached from the header, not the tab bar.
 *
 * Everything that used to sit under More. It is not somewhere you go during
 * chores, so it does not get one of the four places a thumb can reach without
 * looking; Growing does.
 */
export function SettingsScreen(): React.ReactElement {
  return (
    <Screen title="Settings" back>
      <Panel label="Not built yet">
        <Body>
          Sync diagnostics and the rejected inbox arrive with the engine in R3, sign-out with
          auth in R5. Your frost dates will live here too — they are what the growing schedule
          is built from.
        </Body>
      </Panel>
    </Screen>
  );
}
