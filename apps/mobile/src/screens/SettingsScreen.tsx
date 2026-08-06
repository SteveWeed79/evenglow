import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { readSite } from '@steading/core/read/growing';
import { Row } from '../components/Form';
import { Icon } from '../components/Icon';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { type CachedClaims, readCachedClaims, signOut } from '../auth/session';
import { useLive } from '../hooks/useLive';
import { useNav } from '../hooks/useNav';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * Settings — reached from the header, not the tab bar.
 *
 * It is not somewhere you go during chores, so it does not get one of the four
 * places a thumb can reach without looking; Growing does.
 *
 * It is also where the things that are not a tab live: who else is on the
 * farm, what is under the broody, sync details, and the frost dates every
 * growing date is counted from. Each of those is a once-or-twice-a-year visit,
 * which is exactly what this screen is for.
 */
export function SettingsScreen({ onSignedOut }: { onSignedOut: () => void }): React.ReactElement {
  const { colors } = useTheme();
  const nav = useNav();
  const site = useLive(readSite);

  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Whether this device has an account, read from the claims cache.
   *
   * UX only, which is all a cached claim may ever be (invariant 8) — it
   * decides which of two sentences a row shows and nothing else. A device
   * that guessed wrong would offer somebody an account they already have,
   * which is a wasted tap rather than a security question.
   */
  const [account, setAccount] = useState<CachedClaims | null>(null);
  useEffect(() => {
    void readCachedClaims().then(setAccount);
  }, []);

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
      <View style={styles.rows}>
        {/* First, because it decides what the rest of the app even shows. */}
        <Row
          title="My farm"
          detail="What you run — animals, crops, machines"
          icon="stock"
          testID="go-my-farm"
          onPress={() => nav.navigate('MyFarm')}
        />
        {/**
          * Second, and it says what it buys rather than what it is.
          *
          * "Your account" is a chore nobody opens. What a farm running without
          * one actually needs to know is that its records are on this handset
          * and nowhere else — the third moment in A2.3, and the honest one.
          */}
        <Row
          title={account === null ? 'Keep these records safe' : 'Your account'}
          detail={
            account === null
              ? 'Everything is on this phone only — an account keeps a copy'
              : `Signed in${account.name === undefined ? '' : ` as ${account.name}`}`
          }
          icon="sync"
          testID="go-account"
          onPress={() => nav.navigate('Account')}
        />
        <Row
          title="Who is on this farm"
          detail="Invite someone, or change what they may do"
          icon="head-count"
          testID="go-members"
          onPress={() => nav.navigate('Members')}
        />
        <Row
          title="Eggs under"
          detail="Sets in the incubator or under a broody"
          icon="egg"
          testID="go-incubations"
          onPress={() => nav.navigate('Incubations')}
        />
        <Row
          title="The shelf"
          detail="Feed, bedding, medicine and parts"
          icon="parts"
          onPress={() => nav.navigate('Inventory')}
        />
        <Row
          title="Your ground"
          detail={
            site?.frost === undefined
              ? 'Frost dates — nothing on Growing works without them'
              : 'Frost dates and hardiness zone'
          }
          icon="season"
          testID="go-site"
          onPress={() => nav.navigate('SiteSetup')}
        />
        <Row
          title="Get your records out"
          detail="Spreadsheets for a vet, an accountant, or whoever buys the tractor"
          icon="export"
          testID="go-export"
          onPress={() => nav.navigate('Export')}
        />
        <Row
          title="Sync"
          detail="What is waiting, what was refused, and why"
          icon="diagnostics"
          testID="go-diagnostics"
          onPress={() => nav.navigate('Diagnostics')}
        />
        {/**
          * Under Sync, because that is where somebody with a problem has just
          * been — and the numbers on that screen are most of what a report is
          * made of.
          */}
        <Row
          title="Something is wrong"
          detail="Tell us what happened — the app fills in the rest"
          icon="needs-a-look"
          testID="go-support"
          onPress={() => nav.navigate('Support')}
        />
        <Row
          title="Licences"
          detail="The open-source typefaces this app is set in"
          icon="basic-full"
          testID="go-licences"
          onPress={() => nav.navigate('Licences')}
        />
      </View>

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
  rows: { gap: SPACE.sm },
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
