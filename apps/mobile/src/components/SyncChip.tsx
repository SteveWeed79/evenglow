import { Pressable, StyleSheet, Text } from 'react-native';
import type { SyncState } from '@steading/core/sync/engine';
import { Icon, type IconName } from './Icon';
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
 */

function describe(
  state: SyncState,
  colors: { leaf: string; damson: string; rowan: string },
): { label: string; icon: IconName; tint: string } {
  switch (state.kind) {
    case 'synced':
      return { label: 'Saved', icon: 'saved', tint: colors.leaf };
    case 'queued':
      return { label: `${state.count} waiting`, icon: 'waiting', tint: colors.damson };
    case 'syncing':
      return { label: `Sending ${state.count}`, icon: 'sending', tint: colors.damson };
    case 'rejected':
      return { label: `${state.count} need a look`, icon: 'needs-a-look', tint: colors.rowan };
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
  const { label, icon, tint } = describe(state, colors);

  return (
    <Pressable
      onPress={() => nav.navigate(state.kind === 'rejected' ? 'Inbox' : 'Diagnostics')}
      accessibilityRole="button"
      accessibilityLabel={`Sync: ${label}`}
      accessibilityHint={
        state.kind === 'rejected' ? 'Opens what needs a look' : 'Opens sync details'
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
      <Icon name={icon} size={16} color={tint} />
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
