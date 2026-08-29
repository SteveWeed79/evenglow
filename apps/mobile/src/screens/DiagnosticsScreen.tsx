import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { diagnostics, type Diagnostics, nudge, subscribe } from '@homefarm/core/sync/engine';
import { pullOnce } from '@homefarm/core/sync/pull';
import { type StorageReport, storageReport } from '@homefarm/core/sync/storage';
import { readCachedClaims } from '../auth/session';
import { readLocalOrgId } from '../auth/local-org';
import { apiFault, explainFault } from '../boot/config';
import { APP_BUILD, APP_VERSION } from '../version';
import { localStore } from '@homefarm/core/db/store';
import type { SessionEnd } from '@homefarm/core/db/port';
import { Row, Secondary } from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useNav } from '../hooks/useNav';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * Why the queue is not moving.
 *
 * The screen somebody opens when they are already worried a morning's work is
 * gone, so every number on it comes from the store the app is actually using —
 * `diagnostics()` reads them all through the port for exactly that reason.
 * Half of them used to be read straight out of IndexedDB while the other half
 * went through the port, which on a handset meant the first device run
 * reported one mutation queued and an outbox containing nothing.
 *
 * The first sentence is the one that matters and it is a reassurance, not a
 * status: everything logged is on this device whether or not any of the
 * numbers below look wrong.
 */
export function DiagnosticsScreen(): React.ReactElement {
  const nav = useNav();

  const [report, setReport] = useState<Diagnostics | null>(null);
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const [pulling, setPulling] = useState(false);
  const [farmId, setFarmId] = useState<string | null>(null);
  const [ended, setEnded] = useState<SessionEnd | null>(null);

  useEffect(() => {
    void readCachedClaims().then((claims) =>
      claims === null ? readLocalOrgId().then(setFarmId) : setFarmId(claims.orgId),
    );
    void localStore().getSessionEnd().then(setEnded);
  }, []);

  // Fixed for the life of the process — applied once in `start()`, before any
  // screen rendered.
  const fault = apiFault();

  const refresh = useCallback(async () => {
    const [next, backing] = await Promise.all([diagnostics(), storageReport()]);
    setReport(next);
    setStorage(backing);
  }, []);

  useEffect(() => subscribe(() => void refresh()), [refresh]);

  const pull = useCallback(async () => {
    setPulling(true);
    // Errors are swallowed on purpose: a failed pull is already described by
    // `lastError` below, and a second message about the same failure would be
    // the screen contradicting itself.
    await pullOnce().catch(() => undefined);
    setPulling(false);
    await refresh();
  }, [refresh]);

  // `back`, because this screen is pushed. Without it the wait draws a tab
  // header — no way out, a quick-add and a gear — and lays the content out
  // as though a rail were taking width a pushed screen never gives up.
  if (report === null) return <Screen title="Sync" back>{null}</Screen>;

  return (
    <Screen title="Sync" back>
      <Panel label="First, the important part">
        <Body>
          Everything you have logged is on this device. Nothing below can lose it — sync is how
          it reaches your other devices and your farm, not where it lives.
        </Body>
      </Panel>

      {/* Above the queue, because every number in it is explained by this one
          fact: nothing is being sent, and nothing will be, until somebody sets
          an address. Reading "0 last sent, network connected" without this
          would send a person looking for a fault that is not there. */}
      {fault === null ? null : (
        <Panel label="This app has no farm server">
          <Body>{explainFault(fault)}</Body>
        </Panel>
      )}

      <Panel label="The queue">
        <Stat label="Waiting to send" value={String(report.queued)} />
        <Stat label="Need a look" value={String(report.rejected)} />
        <Stat label="In the outbox" value={String(report.outboxTotal)} />
        <Stat
          label="Last sent"
          value={
            report.lastSyncAt === null
              ? 'never'
              : new Date(report.lastSyncAt).toLocaleString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })
          }
        />
        <Stat label="Network" value={report.online ? 'connected' : 'offline'} />
      </Panel>

      {report.rejected > 0 ? (
        <Row
          title={`${report.rejected} need a look`}
          detail="The server refused these — send them again or throw them away"
          testID="go-inbox"
          onPress={() => nav.navigate('Inbox')}
        />
      ) : null}

      {/**
        * Why this device stopped being signed in, when it has.
        *
        * **"It makes me sign in again" was reported four times and diagnosed
        * by inference three of them.** Each inference found a real defect and
        * each fix was right, and the report came back — because a refusal from
        * the server, a token that had gone, and a deliberate sign-out all left
        * the device saying exactly the same nothing. This is the screen
        * somebody is already sent to when sync is the problem, so it is where
        * the answer belongs.
        *
        * Cleared by signing in, so it describes a fault rather than accruing a
        * history nobody reads.
        */}
      {ended === null ? null : (
        <Panel label="The last time this device signed out">
          <Body>{describeSessionEnd(ended)}</Body>
          {ended.detail === undefined ? null : (
            /* The server's own words, verbatim — the same reasoning as `Last
               error` below: a sentence read back to whoever can help beats a
               tidier one that lost the detail. */
            <Body>{ended.detail}</Body>
          )}
        </Panel>
      )}

      {report.lastError === null ? null : (
        <Panel label="Last error">
          {/* Verbatim. A message a farmer can read back to whoever can help is
              worth more than a tidier one that loses the detail. */}
          <Body>{report.lastError}</Body>
        </Panel>
      )}

      <Panel label="This device">
        {/**
          * The farm id, and it is on this screen because this is where somebody
          * is sent when sync is the problem.
          *
          * Not a secret — the access token has carried it on every request
          * since there was one — and it is the only handle that identifies a
          * farm to whoever runs the server, which is what makes it the thing
          * to read out. It also names the database file (`db/open.ts`), so it
          * is the first thing worth knowing when a farm looks empty.
          */}
        <Stat label="Farm id" value={farmId ?? 'not set'} whole />
        {/* Which build, so a tester can read it out and a report can name it
            without anybody being asked. */}
        <Stat label="Build" value={APP_BUILD === '' ? APP_VERSION : `${APP_VERSION}+${APP_BUILD}`} />
        <Stat label="Device id" value={report.deviceId ?? 'not set'} whole />
        <Stat
          label="Caught up to"
          value={
            report.pulledThrough === 0
              ? 'nothing pulled yet'
              : new Date(report.pulledThrough).toLocaleString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })
          }
        />
        <Stat label="Set aside as unreadable" value={String(report.quarantined)} />
        <Body>
          {storage?.persisted === true
            ? 'Your records are a file in this app’s own storage. Idle time does not remove it — only uninstalling the app or clearing its data does.'
            : 'Storage durability on this device could not be confirmed.'}
        </Body>
      </Panel>

      {/**
       * Records the farm has that this build cannot read.
       *
       * The server ships a new kind of record to every device the moment it
       * knows one, including the ones running last month's APK. Those rows are
       * skipped deliberately — parsing the page as a unit meant one unreadable
       * row failed all of it and that install stopped receiving **anything**,
       * permanently, while reporting itself up to date.
       *
       * So the skip is right and the silence was not. A device missing a whole
       * kind of record must not look identical to one that has everything, and
       * until this panel the count existed and nothing showed it.
       *
       * Not phrased as a fault: nothing is wrong with the phone and nothing is
       * lost on the server. The action is an app update, and saying so is the
       * whole value of the panel.
       */}
      {report.unmodelable > 0 ? (
        <Panel label="Newer than this app">
          <Body>
            {report.unmodelable} {report.unmodelable === 1 ? 'record' : 'records'} on the farm’s
            server {report.unmodelable === 1 ? 'is' : 'are'} a kind this version of the app does
            not know about, so {report.unmodelable === 1 ? 'it was' : 'they were'} left out.
          </Body>
          <Body>
            Nothing is lost — the server still has {report.unmodelable === 1 ? 'it' : 'them'}, and
            updating the app is what brings {report.unmodelable === 1 ? 'it' : 'them'} in.
            Everything else on this phone is up to date.
          </Body>
        </Panel>
      ) : null}

      {/**
       * What the one-time repair took away.
       *
       * Those records were commands the server refused, written into this
       * device as though they had been accepted — so removing them was right,
       * and it is still a record vanishing off a farm's screens. Somebody who
       * notices deserves to find a sentence about it here rather than wonder.
       */}
      {report.repaired > 0 ? (
        <Panel label="Records put right">
          <Body>
            {report.repaired} {report.repaired === 1 ? 'record' : 'records'} on this phone had
            never actually been accepted by the farm’s server, and{' '}
            {report.repaired === 1 ? 'was' : 'were'} removed once the server’s own history had
            been read back in full.
          </Body>
          <Body>
            This happened once, automatically. Nothing that reached the server was touched.
          </Body>
        </Panel>
      ) : null}

      {/**
       * The one check that can detect data leaving storage without the server
       * ever acknowledging it — eviction, a failed migration, a wipe. Two
       * integers rather than a duplicate of the whole store, which is why it
       * can run on every open.
       */}
      {report.integrity.missing > 0 ? (
        <Panel label="Something does not line up">
          <Body>
            {report.integrity.missing}{' '}
            {report.integrity.missing === 1 ? 'record' : 'records'} left this device without the
            server confirming them. Of {report.integrity.everEnqueued} ever logged here,{' '}
            {report.integrity.cleared} were confirmed sent and {report.integrity.actualInOutbox}{' '}
            are still in the outbox — which is {report.integrity.expectedInOutbox} short of what
            it should be.
          </Body>
          <Body>
            This is the app telling you what it found rather than quietly working around it.
            Anything still here is safe.
          </Body>
        </Panel>
      ) : null}

      <View style={styles.actions}>
        {/* Forced, because this is the button somebody presses when they do
            not believe the app. Without it the press obeys the same `online`
            flag it exists to overrule, and does nothing while saying nothing
            — see NudgeOptions.force. */}
        <Secondary
          label="Try sending now"
          onPress={() => nudge(undefined, { force: true })}
          testID="nudge"
        />
        <Secondary
          label={pulling ? 'Fetching…' : 'Fetch from the farm'}
          onPress={() => void pull()}
        />
      </View>
    </Screen>
  );
}

function Stat({
  label,
  value,
  whole = false,
}: {
  label: string;
  value: string;
  /**
   * Show every character, on its own line, and let it be copied.
   *
   * **For the values somebody has to reproduce exactly**, which on this screen
   * means the two identifiers. A ULID is 26 characters and a device id is 36;
   * beside a label on a phone row they clipped to
   * `01KYJB4K0KFKTD3K7JSAY5T4…`, and the comment above the farm id says in so
   * many words that it is "the thing to read out".
   *
   * It was read out — into a terminal, ellipsis and all, against a command
   * that then correctly reported no such farm. The id was never wrong; the
   * screen only ever showed part of it.
   */
  whole?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();

  if (whole) {
    return (
      <View style={styles.wholeStat}>
        <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
        {/* Selectable so it can be long-pressed and copied rather than
            transcribed from a screen in a barn. */}
        <Text style={[styles.wholeValue, { color: colors.ink }]} selectable>
          {value}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.stat}>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: colors.ink }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: SPACE.sm },
  stat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACE.md,
  },
  wholeStat: { gap: 2 },
  statLabel: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.6 },
  // Left, not right: a value on its own line has nothing to align against, and
  // an id is read left to right whatever else is on the screen.
  wholeValue: { fontFamily: FONTS.data, fontSize: TYPE.body },
  statValue: { flexShrink: 1, fontFamily: FONTS.data, fontSize: TYPE.body, textAlign: 'right' },
});

/** One sentence, naming which of the three it was and when. */
function describeSessionEnd(ended: SessionEnd): string {
  const when = new Date(ended.at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });

  if (ended.reason === 'signed-out') return `You signed out on ${when}.`;
  if (ended.reason === 'no-token') {
    return (
      `On ${when} this device had a farm cached but no sign-in left to renew — ` +
      'which on Android is what an app being reinstalled does, because the ' +
      'keys that protect it are removed with the app.'
    );
  }
  return `On ${when} the farm server refused to renew this device's sign-in.`;
}
