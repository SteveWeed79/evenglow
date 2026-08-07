import { useCallback, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { buildExport, type ExportRange, type Sheet } from '@steading/core/export/csv';
import { Choice, Failure, Field, Row } from '../components/Form';
import { Loading } from '../components/Missing';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { useLive } from '../hooks/useLive';

/**
 * Getting a farm's records out of the app.
 *
 * Parity floor P7 and P9. The app could show two years of records and hand
 * none of them to an accountant, a vet, or somebody buying a tractor — and a
 * farm that cannot get its data out is a farm that cannot leave.
 *
 * ## One file at a time, not a bundle
 *
 * Thirteen sheets shared at once is a zip, which is another dependency and a
 * worse experience: nobody wants thirteen files when they came for the
 * treatments their vet asked about. Each sheet shares on its own, and the row
 * count is on the row so the choice is informed before the share sheet opens.
 *
 * ## Why this needs two native modules
 *
 * `Share.share({ message })` ships text, not a file. A year of egg logs is
 * roughly 90 KB of CSV, and Android's intent payload limit throws
 * `TransactionTooLargeException` well before that — so the platform primitive
 * cannot do this job at all, not merely less neatly. `expo-file-system` writes
 * the file and `expo-sharing` attaches it; both run in Expo Go, so neither
 * costs a prebuild.
 *
 * ## Written to the cache, deliberately
 *
 * `Paths.cache` rather than `Paths.document`: the file exists to be handed to
 * another app and has no value once it has been. The OS may reclaim it, which
 * is correct — a farm's records live in SQLite, and a stale CSV sitting in
 * app storage is a second copy that can disagree with the first.
 */

const RANGES = ['year', 'all'] as const;
type RangeKey = (typeof RANGES)[number];

const RANGE_LABELS: Record<RangeKey, string> = {
  year: 'The last year',
  all: 'Everything',
};

const DAY = 86_400_000;

/**
 * Stable, so `useLive` does not resubscribe on every render.
 *
 * The whole export is built for the screen rather than per share: the counts
 * are what make the list worth reading, and they cannot be shown without
 * having built the rows anyway.
 */
const readAll = (): Promise<Sheet[]> => buildExport();

export function ExportScreen(): React.ReactElement {
  const everything = useLive(readAll, 'your records');

  const [range, setRange] = useState<RangeKey>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const share = useCallback(
    async (name: string): Promise<void> => {
      setProblem(null);
      setBusy(name);

      try {
        if (!(await isAvailableAsync())) {
          throw new Error('This device has nothing to share files with.');
        }

        // Rebuilt at share time so the range applies. The listing above is
        // everything; this is what actually goes.
        const window: ExportRange = range === 'year' ? { from: Date.now() - 365 * DAY } : {};
        const sheet = (await buildExport(window)).find((s) => s.name === name);

        if (sheet === undefined) {
          throw new Error(`Nothing in ${name} for that period.`);
        }

        /**
         * Dated in the filename, because the file leaves the app and has to
         * say what it is from the outside. `steading-eggs-2026-08-03.csv`
         * survives being one of forty attachments in somebody's inbox.
         */
        const today = new Date().toISOString().slice(0, 10);
        const file = new File(Paths.cache, `steading-${name}-${today}.csv`);
        file.create({ overwrite: true });
        file.write(sheet.csv);

        await shareAsync(file.uri, {
          mimeType: 'text/csv',
          UTI: 'public.comma-separated-values-text',
          dialogTitle: `Steading — ${name}`,
        });
      } catch (error) {
        // Named rather than swallowed: a share that silently did nothing is
        // the failure people retry forever.
        setProblem(error instanceof Error ? error.message : 'That could not be shared.');
      } finally {
        setBusy(null);
      }
    },
    [range],
  );

  if (everything === null) return <Loading title="Get your records out" />;

  if (everything.length === 0) {
    return (
      <Screen title="Get your records out" back>
        <Panel label="Nothing to send yet">
          <Body>
            Once you have logged something it can be sent from here as a spreadsheet — one file
            per kind of record, for a vet, an accountant, or whoever buys the tractor.
          </Body>
        </Panel>
      </Screen>
    );
  }

  return (
    <Screen title="Get your records out" back>
      <Panel label="Yours to keep">
        <Body>
          These are spreadsheets, opened by anything. Sending one changes nothing on this device
          — your records stay exactly where they are.
        </Body>
      </Panel>

      <Field label="How far back?">
        <Choice options={RANGES} value={range} onChange={setRange} labels={RANGE_LABELS} />
      </Field>

      {everything.map((sheet) => (
        <Row
          key={sheet.name}
          title={sheet.name}
          detail={
            busy === sheet.name
              ? 'Preparing…'
              : `${sheet.rows} ${sheet.rows === 1 ? 'record' : 'records'} in total`
          }
          testID={`export-${sheet.name}`}
          onPress={() => void share(sheet.name)}
        />
      ))}

      <Failure message={problem} />
    </Screen>
  );
}
