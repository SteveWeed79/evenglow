import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { readExposure } from '@steading/core/backup/exposure';
import { readSite } from '@steading/core/read/growing';
import { Row } from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
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
  const exposure = useLive(readExposure);

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
          testID="go-my-farm"
          onPress={() => nav.navigate('MyFarm')}
        />
        {/**
          * Second, and it says what it buys rather than what it is.
          *
          * "Your account" is a chore nobody opens. What a farm running without
          * one actually needs to know is that its records are on this handset
          * and nowhere else — the third moment in A2.3, and the honest one.
          *
          * **It counts now, and that is the whole change.** "Everything is on
          * this phone only" is true on day one about four records and in year
          * two about two thousand, so it says the same thing whether or not it
          * matters — which is how a row becomes furniture. A number is a fact
          * somebody can weigh.
          */}
        <Row
          title={account === null ? 'Keep these records safe' : 'Your account'}
          detail={
            account !== null
              ? `Signed in${account.name === undefined ? '' : ` as ${account.name}`}`
              : exposure === null
                ? 'An account keeps a copy off this phone'
                : `${exposure.records.toLocaleString()} records on this phone only — an account keeps a copy`
          }
          testID="go-account"
          onPress={() => nav.navigate('Account')}
        />
        <Row
          title="Who is on this farm"
          detail="Invite someone, or change what they may do"
          testID="go-members"
          onPress={() => nav.navigate('Members')}
        />
        <Row
          title="Eggs under"
          detail="Sets in the incubator or under a broody"
          testID="go-incubations"
          onPress={() => nav.navigate('Incubations')}
        />
        <Row
          title="The shelf"
          detail="Feed, bedding, medicine and parts"
          onPress={() => nav.navigate('Inventory')}
        />
        <Row
          title="Your ground"
          detail={
            site?.frost === undefined
              ? 'Frost dates — nothing on Growing works without them'
              : 'Frost dates and hardiness zone'
          }
          testID="go-site"
          onPress={() => nav.navigate('SiteSetup')}
        />
        {/**
          * "Cannot be put back" is the load-bearing half of this line.
          *
          * Export is the word most people already attach to backing up, and
          * these two rows sit one above the other. Without it, somebody
          * frightened about a failing phone sends themselves thirteen
          * spreadsheets, believes they are covered, and finds out otherwise on
          * the worst possible day.
          */}
        <Row
          title="Get your records out"
          detail="Spreadsheets for a vet or an accountant — they cannot be put back"
          testID="go-export"
          onPress={() => nav.navigate('Export')}
        />
        {/**
          * Beside the export and not inside it, because they are different
          * acts with different audiences. A spreadsheet goes to a person and
          * loses every id on the way out by design; this comes back.
          *
          * The date is here rather than only on the screen behind it because
          * it is the one fact that makes a wrong answer discoverable. Taking a
          * copy stamps the date when the file is written, and the share sheet
          * never reports whether anything took it — so somebody who opened the
          * sheet and backed out has bought silence they did not earn, and the
          * only defence against that is being able to see what the app thinks
          * happened.
          */}
        <Row
          title="A copy of your farm"
          detail={
            exposure === null
              ? 'One file with every record in it, to keep somewhere else'
              : exposure.records === 0
                ? 'Put a backup from another phone onto this one'
                : exposure.lastBackupAt === null
                  ? 'One file with every record in it — none taken yet'
                  : `Last taken ${new Date(exposure.lastBackupAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}`
          }
          testID="go-backup"
          onPress={() => nav.navigate('Backup')}
        />
        <Row
          title="Sync"
          detail="What is waiting, what was refused, and why"
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
          testID="go-support"
          onPress={() => nav.navigate('Support')}
        />
        <Row
          title="Licences"
          detail="The open-source typefaces this app is set in"
          testID="go-licences"
          onPress={() => nav.navigate('Licences')}
        />
      </View>

      <Panel label="This device">
        <Body>
          Signing out leaves your farm&rsquo;s records here and keeps anything still waiting to
          send. It only means signing in again next time.
        </Body>

        <Touch affordance="border"
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
            <Text style={[styles.signOutLabel, { color: armed ? '#fff' : colors.ink }]}>
              {armed ? 'Tap again to sign out' : 'Sign out'}
            </Text>
          </View>
        </Touch>
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
