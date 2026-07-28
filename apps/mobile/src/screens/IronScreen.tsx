import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';

/**
 * Iron — equipment and machines.
 *
 * The same shape as the stock screens on purpose: a list, a primary log action
 * per item, a secondary add. The morning list does not sort itself by module,
 * so the two halves of the app should not feel like two apps.
 */
export function IronScreen(): React.ReactElement {
  return (
    <Screen title="Iron">
      <Panel label="The shell only">
        <Body>
          Machines, hour meters and service intervals land in R4. Reminders and storage
          readiness are new scope and want a design pass first.
        </Body>
      </Panel>
    </Screen>
  );
}
