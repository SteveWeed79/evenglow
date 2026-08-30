import { StyleSheet, View } from 'react-native';
import { duesFor } from '@homefarm/contracts';
import { DueRow } from './DueRow';
import { LoadingPanel } from './Missing';
import { Body, Panel } from './Panel';
import { useFinishDue, useOpenDue } from '../hooks/useDueActions';
import { useDues } from '../hooks/useDues';
import type { RootParamList } from '../navigation/Root';
import { SPACE } from '../theme/tokens';

/**
 * What is coming for one thing — the other half of the reusable detail screen.
 *
 * `Timeline` answers *what happened to this*; this answers *what does this
 * want next*, and between them they are why an entity is worth opening at all.
 * A panel rather than a screen, for the same reason: it goes beneath whatever a
 * machine, a bed or a group already shows.
 *
 * ## The engine was already there and nothing but Today could see it
 *
 * `useDues` composes twelve builders into a farm-wide list, and the only screen
 * that ever rendered one was Today. So the app knew a tractor's 250-hour
 * service was six weeks out and would not say so on the tractor's own screen —
 * the question somebody opened that screen to ask. Every fact here already
 * existed; nothing computes anything new.
 *
 * ## It shows what Today deliberately hides
 *
 * `todayList` drops `later` rows, because a morning's list that reaches into
 * November is one nobody finishes. `duesFor` keeps them, because that judgement
 * is about Today rather than about the row: a schedule six weeks out is noise
 * in a morning list and the whole content of a machine's screen.
 *
 * Rows with no date survive too. "At 250 hours" on a machine nobody has read
 * twice is a permanent resident on Today and refused there; here it is the
 * schedule, stated honestly, and the way to make it a date is to log an hour
 * reading — which is a button on the same screen.
 *
 * ## Nothing is capped
 *
 * `TodayScreen` caps at five and offers the rest, because it mixes every group,
 * every machine and every bed on one screen. Scoped to one subject the list is
 * short by construction — a group's husbandry is seven rows and those seven
 * rows *are* the husbandry schedule, which is a thing worth reading in full on
 * the group's own screen.
 *
 * Nor is it bundled. `todayBundles` gathers a group's care rows into one line
 * because nine rows differing by one word is a list nobody reads — and the word
 * they differ by is the group's name, which on the group's own screen is
 * already the title.
 */

export function Coming({
  subject,
  label = 'Coming up',
  here,
}: {
  /**
   * The record this is about — or the records, when a screen makes a hop the
   * engine deliberately does not.
   *
   * A bed passes itself and its plantings, because nothing is due for a bed and
   * *"Sungold in Bed 3 wants sowing"* is plainly about the bed. The same hop
   * `Timeline` makes, and made by the screen that means it rather than by a
   * hierarchy walk every panel would inherit. See `duesFor`.
   */
  subject: string | readonly string[];
  /** The panel's heading, when a screen wants to say it differently. */
  label?: string;
  /**
   * The route these rows are being drawn on.
   *
   * A service row resolves to its machine, so on the machine's own screen the
   * chevron would reload the screen somebody is standing on — which reads as a
   * door and is not one. Naming the route drops those taps and keeps the rest:
   * a bed's planting rows still open their plantings, and a group's processing
   * row still opens the scale.
   */
  here?: keyof RootParamList;
}): React.ReactElement {
  const { all, loading } = useDues();
  const open = useOpenDue();
  const finish = useFinishDue();

  // A panel, not a screen — see `LoadingPanel`.
  if (loading) return <LoadingPanel label={label} />;

  const ids = typeof subject === 'string' ? [subject] : subject;
  const now = Date.now();
  const rows = duesFor(all, ids, now);

  if (rows.length === 0) {
    return (
      <Panel label={label}>
        {/* A sentence, never an empty box — the rule `Timeline` states. And
            here the sentence is good news rather than an apology: nothing is
            owed, which is a thing somebody came to find out. */}
        <Body>Nothing is due for this.</Body>
      </Panel>
    );
  }

  return (
    <Panel label={label}>
      <View style={styles.rows}>
        {rows.map((due) => (
          <DueRow key={due.key} due={due} now={now} onPress={open(due, here)} onDone={finish(due)} />
        ))}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  rows: { gap: SPACE.sm },
});
