import { StyleSheet, Text, View } from 'react-native';
import type { SyncState } from '@steading/app/sync/engine';
import { Icon, type IconName } from './Icon';
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

export function SyncChip(): React.ReactElement {
  const state = useSync();
  const { colors } = useTheme();
  const { label, icon, tint } = describe(state, colors);

  return (
    <View
      style={[styles.chip, { backgroundColor: colors.raised, borderColor: colors.border }]}
      accessibilityRole="text"
      accessibilityLabel={`Sync: ${label}`}
    >
      <Icon name={icon} size={16} color={tint} />
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
    </View>
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
