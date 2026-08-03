import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { diagnostics, type Diagnostics, nudge, subscribe } from '@steading/core/sync/engine';
import { pullOnce } from '@steading/core/sync/pull';
import { type StorageReport, storageReport } from '@steading/core/sync/storage';
import { apiFault, explainFault } from '../boot/config';
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
          icon="needs-a-look"
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
        <Stat label="Device id" value={report.deviceId ?? 'not set'} />
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
          icon="try-again"
          onPress={() => nudge(undefined, { force: true })}
          testID="nudge"
        />
        <Secondary
          label={pulling ? 'Fetching…' : 'Fetch from the farm'}
          icon="export"
          onPress={() => void pull()}
        />
      </View>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  const { colors } = useTheme();

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
  statLabel: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.6 },
  statValue: { flexShrink: 1, fontFamily: FONTS.data, fontSize: TYPE.body, textAlign: 'right' },
});
