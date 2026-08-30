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

/**
 * The store has not answered yet. Deliberately blank rather than an empty list.
 *
 * `back` because almost everything that waits on a read is a pushed screen. A
 * tab has to say so: `Screen` reads `back` for the chevron *and* for whether a
 * rail is taking width off the side, so a tab that borrowed the default drew a
 * chevron that goes nowhere and laid its content out 96dp too wide until the
 * read landed.
 */
export function Loading({
  title,
  back = true,
  wide = false,
}: {
  title: string;
  back?: boolean;
  /**
   * Match whatever the screen becomes when the read lands.
   *
   * `wide` moves the content cap from 600 to 1104, and the hero sits inside
   * that cap — so a wide screen that waited at the narrow one drew its title
   * a couple of hundred points to the right and then jumped left. Invisible on
   * a phone, where the window is the cap either way, and the ordinary case on
   * a tablet.
   */
  wide?: boolean;
}): React.ReactElement {
  return (
    <Screen title={title} back={back} wide={wide}>
      {null}
    </Screen>
  );
}

/**
 * The same, for something that is a **panel inside a screen** rather than a
 * screen.
 *
 * `Coming` and `Timeline` are panels and both waited with `<Loading>`, which is
 * a whole `<Screen>` — so while the dues or the history were reading, a second
 * status bar, a second back chevron, a second plaster wall and a second scroll
 * surface rendered inside the first screen's content. Worst beside a detail
 * pane, where that scroll view lands inside the pane's own and neither can
 * then be dragged, which is the defect `Screen` was just repaired for.
 *
 * The label stays and the rows arrive under it, so the panel does not jump
 * when the read lands.
 */
export function LoadingPanel({ label }: { label: string }): React.ReactElement {
  return <Panel label={label}>{null}</Panel>;
}
