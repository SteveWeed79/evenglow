import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { signOut } from '../auth/session';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * Settings — reached from the header, not the tab bar.
 *
 * It is not somewhere you go during chores, so it does not get one of the four
 * places a thumb can reach without looking; Growing does.
 */
export function SettingsScreen({ onSignedOut }: { onSignedOut: () => void }): React.ReactElement {
  const { colors } = useTheme();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Two taps, and the second one says what it will do.
   *
   * Sign-out is not destructive here — the records stay, because the database
   * is per farm and unsent work is the point of the app — but it does mean
   * finding a password before the next log, and that is worth one deliberate
   * tap in a yard where a phone is being handled with gloves on.
   */
  const press = useCallback(async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    await signOut();
    onSignedOut();
  }, [armed, onSignedOut]);

  return (
    <Screen title="Settings" back>
      <Panel label="Not built yet">
        <Body>
          Sync diagnostics and the rejected inbox, your frost dates, and export. Everything the
          app already records is on this device and syncs on its own.
        </Body>
      </Panel>

      <Panel label="This device">
        <Body>
          Signing out leaves your farm&rsquo;s records here and keeps anything still waiting to
          send. It only means signing in again next time.
        </Body>

        <Pressable
          onPress={() => void press()}
          disabled={busy}
          accessibilityRole="button"
          testID="sign-out"
          style={({ pressed }) => [
            styles.signOut,
            {
              backgroundColor: armed ? colors.rowan : colors.ground,
              borderColor: armed ? colors.rowan : colors.border,
              opacity: busy || pressed ? 0.75 : 1,
            },
          ]}
        >
          <View style={styles.row}>
            <Icon name="sign-out" size={24} color={armed ? '#fff' : colors.ink} />
            <Text style={[styles.signOutLabel, { color: armed ? '#fff' : colors.ink }]}>
              {armed ? 'Tap again to sign out' : 'Sign out'}
            </Text>
          </View>
        </Pressable>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  signOut: {
    minHeight: TAP.primary,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACE.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  signOutLabel: { fontFamily: FONTS.display, fontSize: TYPE.lede },
});
