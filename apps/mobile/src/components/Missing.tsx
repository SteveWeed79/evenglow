import { Body, Panel } from './Panel';
import { Screen } from './Screen';

/**
 * The row this screen is about is not here.
 *
 * Reachable in ordinary use rather than only in theory: a screen pushed with
 * an id, backgrounded, and restored by React Navigation after the process
 * died will re-read a store where somebody's other device has since archived
 * that group. The honest answer is a sentence, not an empty form that saves
 * into nothing.
 */
export function Missing({
  title,
  what,
}: {
  title: string;
  /** The farm's word for it — "that group", "that machine". */
  what: string;
}): React.ReactElement {
  return (
    <Screen title={title} back>
      <Panel label="Not here">
        <Body>
          {what} is not on this device any more. It may have been archived somewhere else, or
          this device may not have caught up yet — nothing you logged has been lost.
        </Body>
      </Panel>
    </Screen>
  );
}

/** The store has not answered yet. Deliberately blank rather than an empty list. */
export function Loading({ title }: { title: string }): React.ReactElement {
  return (
    <Screen title={title} back>
      {null}
    </Screen>
  );
}
