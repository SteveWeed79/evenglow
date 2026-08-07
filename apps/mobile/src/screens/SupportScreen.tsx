import { useCallback, useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import type { SupportBundle } from '@steading/contracts';
import type { StoredTicket } from '@steading/core/db/port';
import {
  flushTickets,
  listTickets,
  raiseTicket,
  sendTicket,
  ticketAsText,
  type Filed,
} from '@steading/core/support/tickets';
import { Failure, Field, Row, Primary, Secondary, TextField, Toggle } from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { collectBundle, collectRecords, sizeOf } from '../support/collect';
import { FONTS, SPACE, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Telling somebody the app is wrong (`docs/SUPPORT-LOOP.md`).
 *
 * ## Almost nothing on this screen is typed
 *
 * That is S1 and it is the whole design. The queue depth, the schema version,
 * the rejected-mutation reasons and the last twenty engine errors are already
 * on the device and are a better artefact than steps to reproduce written by
 * somebody holding a bucket. There is one free-text line because people want
 * one, not because the report needs it.
 *
 * ## The two doors, and why the second is a button rather than a fallback
 *
 * S7: if what is broken is sync, a report travelling over the sync transport
 * cannot leave either — the device with the most to say is the one that can
 * say least. So the ordinary path queues and retries, and the share sheet sits
 * beside it saying what it is, for the farm whose sync has been failing for a
 * week and who needs to *choose* the other way out.
 *
 * ## R6 holds here too
 *
 * The ticket is written to the local queue before anything is sent, so the
 * press succeeds whether or not there is signal. What the screen reports
 * afterwards is where it got to, never whether it was recorded.
 */

/** What the records half is, before it is known how big. */
type Records = { state: 'off' } | { state: 'building' } | { state: 'ready'; text: string };

export function SupportScreen(): React.ReactElement {
  const { colors } = useTheme();

  const [said, setSaid] = useState('');
  const [records, setRecords] = useState<Records>({ state: 'off' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [history, setHistory] = useState<StoredTicket[]>([]);

  /**
   * The ticket this visit raised, kept so the other door can send *it*.
   *
   * Sharing a freshly-assembled bundle after a failed send would put a second,
   * near-identical report into the world with a different timestamp — and the
   * farm would have no way to tell whoever reads them that the two are one
   * event.
   */
  const [raised, setRaised] = useState<{ id: string; bundle: SupportBundle } | null>(null);
  const [outcome, setOutcome] = useState<Filed | null>(null);

  const refresh = useCallback(async () => {
    setHistory(await listTickets(10));
  }, []);

  /**
   * Anything held gets one try on open, and this is the only place that
   * happens.
   *
   * Not on a timer and not from the sync loop: a ticket about a broken sync
   * must not be retried by the machinery it is about, and a device in a crash
   * loop retrying reports on a schedule would spend its battery on its own bad
   * news. Somebody opening this screen is the honest signal that the situation
   * may have changed.
   */
  useEffect(() => {
    void flushTickets()
      .catch(() => 0)
      .then(refresh);
  }, [refresh]);

  /**
   * Built when the toggle goes on, so the size can be shown before the answer
   * counts.
   *
   * Somebody agreeing to send their farm's records is entitled to know whether
   * that is forty kilobytes or four megabytes first, and the only honest way
   * to say how much is to have it in hand.
   */
  const consent = useCallback(async (next: boolean) => {
    if (!next) {
      setRecords({ state: 'off' });
      return;
    }

    setRecords({ state: 'building' });
    try {
      setRecords({ state: 'ready', text: await collectRecords() });
    } catch {
      // The report is still worth sending without them, so this is a refusal
      // of the extra half rather than of the whole screen.
      setRecords({ state: 'off' });
      setProblem('Your records could not be gathered. The report can still go without them.');
    }
  }, []);

  const send = useCallback(async () => {
    setBusy(true);
    setProblem(null);

    try {
      const bundle = await collectBundle(said);
      const { id, filed } = await raiseTicket(
        bundle,
        records.state === 'ready' ? records.text : undefined,
      );

      setRaised({ id, bundle });
      setOutcome(filed);
      await refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That report could not be made.');
    } finally {
      setBusy(false);
    }
  }, [said, records, refresh]);

  /**
   * The other door (S7). No server, no account, no signal beyond whatever the
   * app it is shared into uses.
   *
   * The lean bundle only — a farm's records are megabytes and no share target
   * would take them as a message. `ticketAsText` says so rather than leaving
   * somebody to wonder where the option went.
   */
  const shareIt = useCallback(async () => {
    setProblem(null);

    try {
      const bundle = raised?.bundle ?? (await collectBundle(said));
      await Share.share({ message: ticketAsText(bundle) });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be shared.');
    }
  }, [raised, said]);

  const retry = useCallback(
    async (id: string) => {
      setBusy(true);
      const filed = await sendTicket(id);
      setBusy(false);
      setOutcome(filed);
      await refresh();
    },
    [refresh],
  );

  const held = history.filter((ticket) => ticket.sentAt === undefined);

  return (
    <Screen title="Something is wrong" back>
      <Panel label="What this sends">
        <Body>
          This app already knows what went wrong — how much is waiting to send, what the server
          refused and why, and what it tripped over itself. That is what a report is made of, so
          there is nothing here you have to fill in.
        </Body>
        <Body>
          It carries no names, no farm, no locations and none of your records unless you say so
          below.
        </Body>
      </Panel>

      <Field label="Anything you want to add?" hint="One line. Skip it if you would rather.">
        <TextField
          value={said}
          onChangeText={setSaid}
          placeholder="The egg total looked wrong on Tuesday"
          maxLength={500}
          multiline
          testID="support-said"
        />
      </Field>

      {/**
       * The question, asked at the moment a ticket is raised rather than
       * buried in a settings toggle — and the answer applies to this report
       * only (S2). Default no, always.
       */}
      <Field
        label="Send your farm's records too?"
        hint="Some faults cannot be found without the data — a date that comes out wrong, a total that disagrees with the log. This is the same set of spreadsheets Get your records out makes, and it goes only if you say so."
      >
        <Toggle
          label={
            records.state === 'building'
              ? 'Gathering them…'
              : records.state === 'ready'
                ? `Send my records with this — ${sizeOf(records.text)}`
                : 'Send my records with this report'
          }
          value={records.state !== 'off'}
          onChange={(next) => void consent(next)}
          testID="support-records"
        />
      </Field>

      {outcome === null ? null : (
        <Panel label={outcome.ok ? 'Sent' : 'Kept on this phone'}>
          <Body>
            {outcome.ok
              ? 'That is filed. Nothing else is needed from you.'
              : `${outcome.error ?? 'It could not be sent.'} It is saved here and will go the next time you open this screen — or send it another way, below.`}
          </Body>
          {/* The farm was asked a question and said yes; it is owed the truth
              about what happened to the answer. */}
          {outcome.note === undefined ? null : <Body>{outcome.note}</Body>}
        </Panel>
      )}

      <Failure message={problem} />

      <View style={styles.actions}>
        <Primary
          label={busy ? 'Sending…' : 'Send this report'}
          onPress={() => void send()}
          disabled={busy || records.state === 'building'}
          testID="support-send"
        />
        {/**
         * Beside the ordinary path, not hidden behind its failure.
         *
         * A farm whose sync has been broken for a week already knows the queue
         * will not empty. Making them press the button that will not work
         * first, in order to earn the one that will, is the loop failing at
         * the exact moment it is needed.
         */}
        <Secondary
          label="Send it another way"
          onPress={() => void shareIt()}
          testID="support-share"
        />
      </View>

      {held.length === 0 ? null : (
        <Panel label={held.length === 1 ? 'One report waiting' : `${held.length} reports waiting`}>
          <Body>
            These are on this phone and have not reached anybody yet. Nothing is lost — they keep
            until they can go.
          </Body>
        </Panel>
      )}

      {history.length === 0 ? null : (
        <View style={styles.rows}>
          {history.map((ticket) => (
            <Row
              key={ticket.id}
              title={new Date(ticket.at).toLocaleString(undefined, {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
              detail={describe(ticket)}
              mark={ticket.sentAt === undefined ? 'forward' : 'check'}
              testID={`ticket-${ticket.id}`}
              onPress={() => {
                if (ticket.sentAt === undefined) void retry(ticket.id);
              }}
            />
          ))}
        </View>
      )}

      {/* The fingerprint, quietly, because it is the one string worth reading
          down a phone line: it is what groups this report with everybody
          else's of the same fault. */}
      {raised === null ? null : (
        <Text style={[styles.fingerprint, { color: colors.muted }]} selectable>
          {raised.bundle.fingerprint}
        </Text>
      )}
    </Screen>
  );
}

/**
 * What happened to one report, in a line.
 *
 * The attempt count is on it because a report that failed once and a report
 * that has failed eleven times mean different things, and only one of them is
 * worth pressing again.
 */
function describe(ticket: StoredTicket): string {
  if (ticket.sentAt !== undefined) return 'Sent';

  if (ticket.attempts === 0) return 'Waiting to send — tap to try now';

  return `${ticket.lastError ?? 'Could not be sent'} — tried ${ticket.attempts} ${
    ticket.attempts === 1 ? 'time' : 'times'
  }`;
}

const styles = StyleSheet.create({
  actions: { gap: SPACE.sm },
  rows: { gap: SPACE.sm },
  fingerprint: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 0.6,
    textAlign: 'center',
    marginTop: SPACE.sm,
  },
});
