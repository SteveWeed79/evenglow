import { StyleSheet, Text, View } from 'react-native';
import { heldLabel } from '@homefarm/contracts';
import type { SyncState } from '@homefarm/core/sync/engine';
import { apiFault } from '../boot/config';
import { Touch } from './Touch';
import { useNav } from '../hooks/useNav';
import { useSync } from '../hooks/useSync';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Persistent sync status. Never blocks anything (R6).
 *
 * Queued work is damson, not red. A farm hand who sees red all morning learns
 * to ignore red, and then misses the one morning it means something. Only
 * "needs a look" — a mutation the server refused, which no amount of waiting
 * will fix — gets the alarming colour, and it is the only alarming shape in
 * the icon set too.
 *
 * **A build with no server address gets that same colour**, for the same
 * reason: waiting will not fix it either. Without this the chip would report
 * the ordinary offline story forever, which is the failure the old boot-time
 * throw existed to prevent — the throw was the wrong remedy, but the worry
 * behind it was right, and this is where it is answered instead.
 *
 * **A farm on the free tier gets neither colour**, and that is the whole
 * design of the D13 nag: it is not a fault, so it is not alarming, and it is
 * not in flight, so it is not damson. It states where the records are and how
 * many, and the number grows on its own — which is A2.3's third moment
 * arriving on its own schedule rather than on a timer. No banner, no badge, no
 * modal. If a farm never taps this, it uses the whole app free forever.
 */

function describe(
  state: SyncState,
  colors: { leaf: string; damson: string; rowan: string; muted: string },
): { label: string; tint: string } {
  switch (state.kind) {
    case 'synced':
      return { label: 'Saved', tint: colors.leaf };
    case 'queued':
      return { label: `${state.count} waiting`, tint: colors.damson };
    case 'syncing':
      return { label: `Sending ${state.count}`, tint: colors.damson };
    case 'rejected':
      return { label: `${state.count} need a look`, tint: colors.rowan };
    /**
     * The free tier, and it is **not** rowan.
     *
     * "Not set up" is red because a misconfigured build is broken. A farm on
     * the free tier is not broken — it is the product working exactly as D13
     * designed it, and painting it red would be the app calling its own free
     * tier a fault. That is the nag.
     *
     * Muted rather than damson too: damson is the colour of work in flight,
     * and nothing here is in flight.
     */
    case 'held':
      return { label: heldLabel(state.count), tint: colors.muted };
  }
}

/**
 * Pressable, and where it goes is the whole point.
 *
 * **When something needs a look, the chip goes straight to it.** Making
 * somebody find the rejected inbox behind a diagnostics screen is how
 * "user-visible" (invariant 9) becomes technically-true-but-not-really: the
 * chip is the only thing on screen that says work was refused, so it has to be
 * the way to the work. Everything else lands on diagnostics, which is the
 * right answer to "why does it say four waiting".
 */
export function SyncChip(): React.ReactElement {
  const state = useSync();
  const nav = useNav();
  const { colors } = useTheme();

  /**
   * Read rather than subscribed: the configuration is applied once in
   * `start()`, before the first screen renders, and cannot change while the
   * app is running. There is no state to keep in step.
   */
  const fault = apiFault();

  const { label, tint } =
    fault === null
      ? describe(state, colors)
      : { label: 'Not set up', tint: colors.rowan };

  return (
    <Touch affordance="chevron"
      onPress={() => nav.navigate(state.kind === 'rejected' && fault === null ? 'Inbox' : 'Diagnostics')}
      accessibilityRole="button"
      accessibilityLabel={`Sync: ${label}`}
      accessibilityHint={
        state.kind === 'rejected' && fault === null
          ? 'Opens what needs a look'
          : 'Opens sync details'
      }
      // The chip is small by design — it is status, not an action (R3) — so
      // the target is grown around it rather than the chip being grown.
      hitSlop={12}
      testID="sync-chip"
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: colors.raised, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {/**
       * A dot, not a mark.
       *
       * The chip already says "2 need a look" or "Saved" in words, so a mark
       * beside it drew the same fact twice — and six near-identical circles
       * were six drawings whose whole job was to be told apart at 16px, which
       * is the size at which they cannot be.
       *
       * Colour is never the only carrier (WCAG 1.4.1): the label is the state
       * and the dot is how it is found across a room.
       */}
      <View style={[styles.dot, { backgroundColor: tint }]} />
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
    </Touch>
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: RADII.pill },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs + 2,
    paddingHorizontal: SPACE.sm + 2,
    paddingVertical: SPACE.xs + 1,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  label: { fontFamily: FONTS.data, fontSize: TYPE.label - 1, letterSpacing: 0.6 },
});
