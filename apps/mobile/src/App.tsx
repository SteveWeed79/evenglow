import { NavigationContainer, type Theme as NavTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Tabs } from './navigation/Tabs';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';
import { accent, font } from './theme/tokens';

/**
 * The root.
 *
 * GestureHandlerRootView wraps everything because the swipe-back gesture and
 * anything built on Reanimated need it above the navigator, and the failure
 * mode when it is missing is silent: gestures simply do nothing.
 */
export function App(): React.ReactElement {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Themed />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Themed(): React.ReactElement {
  const { theme, colors } = useTheme();

  // React Navigation keeps its own palette and paints the gaps between our
  // screens with it — the transition backdrop most visibly. Handing it our
  // tokens is what stops a grey flash mid-push on a plaster wall.
  const navTheme = useMemo<NavTheme>(
    () => ({
      dark: theme === 'lamplight',
      colors: {
        primary: colors.lantern,
        background: colors.ground,
        card: colors.raised,
        text: colors.ink,
        border: colors.line,
        notification: accent.rowan,
      },
      fonts: {
        regular: { fontFamily: font.body, fontWeight: '400' },
        medium: { fontFamily: font.body, fontWeight: '500' },
        bold: { fontFamily: font.display, fontWeight: '700' },
        heavy: { fontFamily: font.display, fontWeight: '900' },
      },
    }),
    [theme, colors],
  );

  return (
    <NavigationContainer theme={navTheme}>
      {/* Inverted, not matched: the bar sits on the ground colour, so its
          glyphs need the opposite of the wall behind them. */}
      <StatusBar style={theme === 'lamplight' ? 'light' : 'dark'} />
      <Tabs />
    </NavigationContainer>
  );
}
