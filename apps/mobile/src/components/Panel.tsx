import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { font, lift, radii, space, type as typeScale } from '../theme/tokens';

/**
 * A card on the wall.
 *
 * Square-headed on purpose: the arch is the motif and it needs an ellipse RN
 * cannot express as a radius, so an approximated arch here would read as a
 * blob and quietly redefine the one shape the app is recognised by. The real
 * arch gets drawn in SVG during the design pass. Until then this is honestly
 * a rectangle rather than dishonestly a doorway.
 */
export function Panel({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View style={[styles.panel, lift, { backgroundColor: colors.raised, borderColor: colors.line }]}>
      {label ? <Text style={[styles.label, { color: colors.muted }]}>{label}</Text> : null}
      {children}
    </View>
  );
}

export function Body({ children }: { children: React.ReactNode }): React.ReactElement {
  const { colors } = useTheme();
  return <Text style={[styles.body, { color: colors.ink }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radii.softHead,
    borderWidth: 1,
    padding: space.lg,
    gap: space.sm,
  },
  label: {
    fontFamily: font.data,
    fontSize: typeScale.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  body: { fontFamily: font.body, fontSize: typeScale.body, lineHeight: typeScale.body * 1.45 },
});
