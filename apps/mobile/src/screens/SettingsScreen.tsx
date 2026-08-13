import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { readExposure } from '@steading/core/backup/exposure';
import { readSite } from '@steading/core/read/growing';
import { Choice, Row } from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { type CachedClaims, readCachedClaims, signOut } from '../auth/session';
import { useFarmName } from '../hooks/useFarmName';
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
 * It holds the once-or-twice-a-year visits: who else is on the farm, the
 * account, the frost dates every growing date is counted from, getting the
 * records out, and what to do when something is wrong.
 *
 * **What is under the broody used to be here and is not any more.** A set of
 * eggs wants candling around day seven and hatches on day twenty-one, which is
 * ordinary keeping rather than configuration — it lives on the Farm hub with
 * the animals now. The shelf went the same way, and it had been in both places
 * at once.
 */
/**
 * "Follow the phone" is the absence of an override, which is why this is not
 * just `ThemeName`.
 *
 * Daylight gets its own row even though it looks like the default, because the
 * lamp in the header can set it: toggling out of lamplight writes `daylight`
 * as a real override. Without a row for it this control would have to render
 * that state as "follow the phone" and would then read as the opposite of what
 * the screen was doing, on a phone whose system theme is dark.
 */
const LOOKS = ['system', 'daylight', 'lamplight', 'sun'] as const;
type Look = (typeof LOOKS)[number];

const LOOK_LABELS: Record<Look, string> = {
  system: 'Follow the phone',
  daylight: 'Daylight',
  lamplight: 'Lamplight',
  sun: 'Bright sun',
};

export function SettingsScreen({ onSignedOut }: { onSignedOut: () => void }): React.ReactElement {
  const { colors, override, setTheme } = useTheme();
  const nav = useNav();
  const farmName = useFarmName();

  // Reads the override rather than the resolved theme, so "follow the phone"
  // stays selected at night instead of jumping to Lamplight on its own.
  const look: Look = override ?? 'system';
  const chooseLook = useCallback(
    (next: Look) => setTheme(next === 'system' ? null : next),
    [setTheme],
  );
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

    /**
     * Say it happened, because nothing else will.
     *
     * Signing out deliberately does not drop to a door — the records are on
     * this device and the app still works, which is the premise (`Boot.tsx`).
     * The consequence nobody accounted for is that **the screen looks
     * identical afterwards**: this row is read once on mount, so it went on
     * saying "Signed in as …" over a device that was no longer signed in.
     *
     * Reported as *"tap again to sign out does nothing"*, and it did not stop
     * there — the tokens were gone, so the next flush deferred, and the fault
     * surfaced later as six items stuck behind a message about signing in
     * again (issue #125). A silent success that only shows up as a failure two
     * screens away is worse than a failure.
     */
    setAccount(null);
    setArmed(false);
    setBusy(false);

    onSignedOut();
  }, [armed, onSignedOut]);

  return (
    <Screen title="Settings" back>
      <View style={styles.rows}>
        {/* First, because it decides what the rest of the app even shows.

            The title is the farm's own name once there is one. This row is the
            natural place for it — it is the row that means "the thing you
            run" — and the account row directly below already carries the
            person's name, so putting the farm's name on both would stutter. */}
        <Row
          title={farmName ?? 'My farm'}
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
        {/**
          * "Eggs under" and "The shelf" used to sit here, and neither belonged.
          *
          * This screen is somewhere you go once and then twice a year. A set of
          * eggs wants candling around day seven and hatches on day twenty-one,
          * and the shelf is read whenever something runs low — both are
          * ordinary keeping, not configuration.
          *
          * They were parked here because Stock, Growing and Iron used to be
          * tabs and anything without a tab had nowhere else to go. When those
          * three became the Farm hub, these two never moved. The shelf was in
          * both places at once, with better words on the hub's copy.
          */}
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

      {/* ## The third theme had no way in
          `sun` has existed since the tokens were written and `setTheme` had no
          caller anywhere in the app, so the one theme built for the condition
          this app is actually used in — a screen in direct light — was
          unreachable. The lamp in the header deliberately will not reach it
          (see `otherTheme`): cycling into high contrast by accident at 5am is
          the opposite of what somebody reaching for that control wants. So it
          is chosen here, deliberately, and never stumbled into. */}
      <Panel label="How it looks">
        <Choice options={LOOKS} value={look} onChange={chooseLook} labels={LOOK_LABELS} />
        <Body>
          Bright sun trades the warm ground for contrast, for reading the screen in direct light.
          It lasts until you close the app.
        </Body>
      </Panel>

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
