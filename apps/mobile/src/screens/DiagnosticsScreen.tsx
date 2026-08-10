import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { diagnostics, type Diagnostics, nudge, subscribe } from '@steading/core/sync/engine';
import { pullOnce } from '@steading/core/sync/pull';
import { type StorageReport, storageReport } from '@steading/core/sync/storage';
import { readCachedClaims } from '../auth/session';
import { readLocalOrgId } from '../auth/local-org';
import { apiFault, explainFault } from '../boot/config';
import { APP_BUILD, APP_VERSION } from '../version';
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

  useEffect(() => {
    void readCachedClaims().then((claims) =>
      claims === null ? readLocalOrgId().then(setFarmId) : setFarmId(claims.orgId),
    );
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

  if (report === null) return <Screen title="Sync">{null}</Screen>;

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
