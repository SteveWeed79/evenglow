import { useCallback, useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { backupFilename, buildBackup, serialiseBackup } from '@homefarm/core/backup/file';
import { readExposure } from '@homefarm/core/backup/exposure';
import {
  planRestore,
  readBackup,
  type RestorePlan,
  runRestore,
} from '@homefarm/core/backup/restore';
import { localStore } from '@homefarm/core/db/store';
import { Confirm, Failure, Primary, Secondary } from '../components/Form';
import { Loading } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { ensureLocalOrgId } from '../auth/local-org';
import { readCachedClaims } from '../auth/session';
import { useFarmName } from '../hooks/useFarmName';
import { useNav } from '../hooks/useNav';
import { APP_VERSION } from '../version';

/**
 * A copy of the farm, and the way back from one.
 *
 * ## Why this screen exists at all
 *
 * Signing in on a new handset already rebuilds everything from the server, and
 * pull is deliberately ungated on billing — a lapsed subscription is never the
 * reason a farm cannot get its records back. So this is for the one farm with
 * no other route home: the one that never made an account (A2.1), whose
 * records are in one file on one phone and nowhere else.
 *
 * Android hands an app no callback before it is uninstalled, so there is no
 * moment to catch somebody at. The only version that works is a copy they can
 * take whenever, plus a reason to take it — which is what the notice on Today
 * is for.
 *
 * ## One screen, two states, and never both
 *
 * A farm with records can take a copy. A farm with none can put one back. They
 * are never the same farm at the same moment, so showing both would mean
 * showing one that cannot do anything — and "Put a backup back" greyed out on
 * a farm with two years of records is a button that reads like a threat.
 *
 * ## An account is the better answer and this says so
 *
 * A file is a copy of a moment; an account is a copy that keeps itself. Every
 * reason to prefer the account is on this screen, above the button, because
 * the honest thing to do with somebody standing in front of a backup button is
 * to tell them what it does not do.
 *
 * ## Why the app cannot find the file by itself
 *
 * The obvious wish is for a new install to notice a backup lying about and
 * offer it. Android will not allow it, and the reason is the same one that
 * makes a backup necessary at all: **uninstalling revokes everything an app
 * had.** Its own directories are deleted, and every Storage Access Framework
 * grant it had persisted is released with them. There is no folder a fresh
 * install may read without being handed it, and the handing over is the
 * picker.
 *
 * The two ways round it are both worse:
 *
 * - **A broad media permission** so the app can scan Downloads. That is asking
 *   for every document on the phone in order to look at one, and it is the
 *   kind of permission Play asks an app to justify.
 * - **Android Auto Backup**, which really is the platform doing this
 *   automatically. It is off in `app.json` on purpose: it would put the
 *   records of a farm with no account into Google's backup without anybody
 *   agreeing to it, and "everything is on this phone only" — which is what
 *   A2.3 says and what this screen repeats — would quietly stop being true.
 *
 * So the picker opens where it was last left, the file is named for its date
 * so it is recognisable in a list, and the screen says plainly where to put it.
 */

/** Where a written backup waits to be shared. See `ExportScreen` for the same argument. */
const WRITE_TO = Paths.cache;

interface Ready {
  /** Records this farm holds. Zero means the restore half. */
  records: number;
  signedIn: boolean;
  lastBackupAt: number | null;
}

export function BackupScreen(): React.ReactElement {
  const nav = useNav();
  // Which farm this copy is of. It matters most on the screen that produces a
  // file destined to sit in a drive next to somebody else's.
  const farm = useFarmName();

  const [ready, setReady] = useState<Ready | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [plan, setPlan] = useState<Extract<RestorePlan, { ok: true }> | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const look = useCallback(async () => {
    const [exposure, claims] = await Promise.all([readExposure(), readCachedClaims()]);
    setReady({
      records: exposure.records,
      signedIn: claims !== null,
      lastBackupAt: exposure.lastBackupAt,
    });
  }, []);

  useEffect(() => {
    void look();
  }, [look]);

  /**
   * Writes the file, stamps the date, offers it to the OS — in that order.
   *
   * The stamp goes before the share sheet rather than after it, and the
   * ordering is deliberate: the share sheet does not report which app took the
   * file or whether that app kept it, so waiting for a result that never
   * arrives would mean a farm that shared a backup to itself still being told
   * its records are in one place. Writing the file is the part this app can
   * actually know happened.
   */
  const take = useCallback(async () => {
    setProblem(null);
    setNote(null);
    setBusy(true);

    try {
      if (!(await isAvailableAsync())) {
        throw new Error('This device has nothing to send files with.');
      }

      const { file, summary } = await buildBackup(await ensureLocalOrgId(), APP_VERSION);

      if (summary.entries === 0) {
        throw new Error('There is nothing logged on this phone to copy yet.');
      }

      /**
       * `file.writtenAt` for the name and for the stamp, rather than a second
       * `Date.now()`.
       *
       * Two clock reads a few milliseconds apart is harmless until a restore:
       * the restoring phone dates its copy from `file.writtenAt`, so a second
       * read here would give the two devices different answers to "when was
       * this taken" for the same file.
       */
      const handle = new File(WRITE_TO, backupFilename(file.writtenAt));
      handle.create({ overwrite: true });
      handle.write(serialiseBackup(file));

      await localStore().setLastBackupAt(file.writtenAt);

      setNote(
        summary.unreadable === 0
          ? `${summary.entries} records copied. Send it somewhere that is not this phone — an email to yourself is enough.`
          : `${summary.entries} records copied. ${summary.unreadable} could not be read and are not in the file.`,
      );

      await shareAsync(handle.uri, {
        mimeType: 'application/json',
        UTI: 'public.json',
        dialogTitle: 'A copy of your farm',
      });

      await look();
    } catch (error) {
      // Named rather than swallowed: a share that silently did nothing is the
      // failure people retry forever.
      setProblem(error instanceof Error ? error.message : 'That could not be copied.');
    } finally {
      setBusy(false);
    }
  }, [look]);

  /**
   * Picks a file and says what putting it back would do. Writes nothing.
   *
   * `File.pickFileAsync` rather than a document-picker dependency: SDK 57's
   * file-system module wraps the same Storage Access Framework the separate
   * package does, and there is nothing a second module would add. The picker
   * opens where it was last left, which is as close to finding the file for
   * somebody as Android permits — see the note below on why that is the
   * ceiling.
   */
  const choose = useCallback(async () => {
    setProblem(null);
    setNote(null);
    setBusy(true);

    try {
      const picked = await File.pickFileAsync({ mimeTypes: ['application/json'] });

      // Backing out of the picker is a decision, not a failure.
      if (picked.canceled) return;

      const read = readBackup(await picked.result.text());
      if (!read.ok) throw new Error(read.message);

      /**
       * Whether this device is signed in, read fresh rather than off `ready`.
       *
       * `ready` is from mount time, and a sign-in on another screen between
       * then and now would leave this holding a stale `false` — which is the
       * one direction that matters, because a restore onto a signed-in device
       * would push one farm's records at another farm's server.
       */
      const planned = await planRestore(read.file, {
        signedIn: (await readCachedClaims()) !== null,
      });
      if (!planned.ok) throw new Error(planned.message);

      if (planned.toWrite.length === 0) {
        setNote('Everything in that backup is already on this phone.');
        return;
      }

      setPlan(planned);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  }, []);

  const put = useCallback(async () => {
    if (plan === null) return;
    setProblem(null);
    setBusy(true);

    try {
      /**
       * Reported every twenty-five, not every one.
       *
       * `runRestore` calls back per record because that is the only honest
       * granularity it has, and a fifteen-hundred-record file would otherwise
       * set React state fifteen hundred times — a re-render per row, on the
       * one screen already doing a SQLite transaction per row. The last record
       * always reports, so the count never stops short of the total.
       */
      const result = await runRestore(plan, ({ done, total }) => {
        if (done % 25 === 0 || done === total) setProgress(`${done} of ${total}`);
      });

      setPlan(null);
      /**
       * When something is lost, it is named.
       *
       * "4 records could not be read" is a wound with no handle — it tells
       * somebody in the middle of recovering a lost phone that four things
       * are gone and gives them nothing to do about it. Two group names is a
       * fact they can act on, usually by typing them back in.
       */
      setNote(
        result.refused === 0
          ? `${result.written} records are back. They are on this phone — take a copy or make an account before you need one.`
          : `${result.written} records are back. These could not be read and are missing: ${result.lost.join(', ')}${
              result.refused > result.lost.length ? `, and ${result.refused - result.lost.length} more` : ''
            }.`,
      );
      await look();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That backup could not be put back.');
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }, [plan, look]);

  if (ready === null) return <Loading title="A copy of your farm" />;

  /**
   * A plan on screen takes the screen, and nothing else is drawn.
   *
   * The alternative was a confirm sitting under two panels about other things,
   * on the one screen in the app where a wrong tap adds a thousand records.
   */
  if (plan !== null) {
    return (
      <Screen title="A copy of your farm" back {...(farm === null ? {} : { subtitle: farm })}>
        <Planned
          plan={plan}
          busy={busy}
          progress={progress}
          onPut={() => void put()}
          onCancel={() => setPlan(null)}
        />
        <Failure message={problem} />
      </Screen>
    );
  }

  return (
    <Screen title="A copy of your farm" back {...(farm === null ? {} : { subtitle: farm })}>
      {/**
        * Taking a copy is offered when there is something to copy. Putting one
        * back is offered **always**, and that is a correction.
        *
        * It used to be the other half of an either/or on `records === 0`,
        * which read tidily and had one consequence nobody would find until it
        * mattered: a restore interrupted by a flat battery leaves records on
        * the phone, so the screen switched to the copy half and there was no
        * longer any way to finish. The resume this was built around was
        * unreachable from the app.
        *
        * The screen is the wrong place to decide it in any case. `planRestore`
        * reads what is actually on the device and refuses in a sentence, so a
        * farm that presses this out of curiosity is told plainly why not
        * rather than being guessed at.
        */}
      {ready.records > 0 ? (
        <TakeHalf
          records={ready.records}
          signedIn={ready.signedIn}
          lastBackupAt={ready.lastBackupAt}
          busy={busy}
          onTake={() => void take()}
          onAccount={() => nav.navigate('Account')}
        />
      ) : null}

      <RestoreOffer
        empty={ready.records === 0}
        busy={busy}
        onChoose={() => void choose()}
      />

      <Failure message={problem} />
      {note === null ? null : (
        <Panel label="Done">
          <Body>{note}</Body>
        </Panel>
      )}
    </Screen>
  );
}

function TakeHalf({
  records,
  signedIn,
  lastBackupAt,
  busy,
  onTake,
  onAccount,
}: {
  records: number;
  signedIn: boolean;
  lastBackupAt: number | null;
  busy: boolean;
  onTake: () => void;
  onAccount: () => void;
}): React.ReactElement {
  return (
    <>
      <Panel label={signedIn ? 'A second copy' : 'On this phone only'}>
        <Body>
          {signedIn
            ? `${records} records are waiting to go to the farm's server. A file is a copy you hold yourself, which is worth having as well.`
            : `${records} records are on this handset and nowhere else. If the phone goes in a trough, so do they.`}
        </Body>
        <Body>
          This makes one file with every record in it — not the photographs, which are far larger
          and stay here. Send it somewhere that is not this phone.
        </Body>
        {lastBackupAt === null ? null : (
          <Body>
            The last copy was taken {new Date(lastBackupAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}.
          </Body>
        )}
      </Panel>

      <Primary
        label={busy ? 'Making the copy…' : 'Make a copy'}
        disabled={busy}
        onPress={onTake}
        testID="backup-take"
      />

      {/**
        * Said after the button, not instead of it.
        *
        * Somebody who opened this screen wants the file, and putting an
        * upsell in front of it would be answering a question they did not
        * ask. What they must not leave without knowing is that a file is a
        * copy of a moment and an account is one that keeps itself.
        */}
      {signedIn ? null : (
        <Panel label="What this does not do">
          <Body>
            A file only holds what was logged up to the moment you made it. An account keeps the
            copy up to date by itself, and it is what puts the same records on a second phone or
            in front of a farm hand.
          </Body>
          <Secondary label="About an account" onPress={onAccount} testID="backup-account" />
        </Panel>
      )}
    </>
  );
}

/**
 * What a file would do, before it does it.
 *
 * Two taps rather than one, and it is the only screen in the app where a
 * `Confirm` guards something that is not destructive. A restore adds records
 * and removes none — but it can add a thousand at once, and undoing that means
 * archiving them one at a time.
 */
function Planned({
  plan,
  busy,
  progress,
  onPut,
  onCancel,
}: {
  plan: Extract<RestorePlan, { ok: true }>;
  busy: boolean;
  progress: string | null;
  onPut: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <>
      <Panel label="Ready to put back">
        <Body>
          {plan.toWrite.length} records from that file will be added to this phone
          {plan.alreadyThere === 0 ? '' : `, and ${plan.alreadyThere} are already here`}.
        </Body>
        <Body>
          Photographs are not in a backup and cannot come back with it. Nothing already on this
          phone is changed or removed.
        </Body>
        {progress === null ? null : <Body>Putting them back — {progress}.</Body>}
      </Panel>

      <Confirm
        label={busy ? 'Putting them back…' : 'Put these records back'}
        armedLabel="Tap again to put them back"
        onConfirm={onPut}
        testID="backup-put"
      />
      <Secondary label="Not now" onPress={onCancel} testID="backup-cancel" />
    </>
  );
}

/**
 * Offered whatever is on the phone, and worded for which.
 *
 * On an empty farm this is the reason somebody opened the screen, so it leads
 * and it is the primary. On a farm with records it is a quiet line under the
 * copy button — reachable, because an interrupted restore has to be
 * finishable, and unalarming, because a farm that presses it gets a sentence
 * back rather than a thousand records.
 */
function RestoreOffer({
  empty,
  busy,
  onChoose,
}: {
  empty: boolean;
  busy: boolean;
  onChoose: () => void;
}): React.ReactElement {
  if (!empty) {
    return (
      <Panel label="Putting one back">
        <Body>
          A backup only goes onto a phone with an empty farm, so this will not do anything while
          these records are here. It is the way to finish one that was interrupted.
        </Body>
        <Secondary
          label={busy ? 'Reading…' : 'Choose a backup file'}
          disabled={busy}
          onPress={onChoose}
          testID="backup-choose"
        />
      </Panel>
    );
  }

  return (
    <>
      <Panel label="Nothing logged here yet">
        <Body>
          If you have a backup file from another phone, this puts its records onto this one. They
          come back with the same names and dates.
        </Body>
        {/* Said here rather than left to be discovered in an empty gallery.
            The file holds the photo records and never the images, so a
            photograph comes back only from a phone that still has it — and a
            restored record now asks for its picture again rather than claiming
            the server already has one. */}
        <Body>
          Photographs are not in the file. The records of them come back, and the pictures
          themselves only if the phone that took them still has them.
        </Body>
        <Body>
          If the farm has an account, signing in is better — it brings everything back including
          anything logged since, and it keeps doing it.
        </Body>
      </Panel>

      <Primary
        label={busy ? 'Reading…' : 'Choose a backup file'}
        disabled={busy}
        onPress={onChoose}
        testID="backup-choose"
      />
    </>
  );
}
