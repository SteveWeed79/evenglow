import { StyleSheet, Text, View } from 'react-native';
import type { SyncState } from '@steading/app/sync/engine';
import { Icon, type IconName } from './Icon';
import { useSync } from '../hooks/useSync';
import { accent, font, radii, space, type as typeScale } from '../theme/tokens';
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

function describe(state: SyncState): { label: string; icon: IconName; tint: string } {
  switch (state.kind) {
    case 'synced':
      return { label: 'Saved', icon: 'saved', tint: accent.leaf };
    case 'queued':
      return { label: `${state.count} waiting`, icon: 'waiting', tint: accent.damson };
    case 'syncing':
      return { label: `Sending ${state.count}`, icon: 'sending', tint: accent.damson };
    case 'rejected':
      return { label: `${state.count} need a look`, icon: 'needs-a-look', tint: accent.rowan };
  }
}

export function SyncChip(): React.ReactElement {
  const state = useSync();
  const { colors } = useTheme();
  const { label, icon, tint } = describe(state);

  return (
    <View
      style={[styles.chip, { backgroundColor: colors.raised, borderColor: colors.line }]}
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
    gap: space.xs + 2,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs + 1,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  label: { fontFamily: font.data, fontSize: typeScale.label - 1, letterSpacing: 0.6 },
});
