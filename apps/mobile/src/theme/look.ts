import { File, Paths } from 'expo-file-system';
import { z } from 'zod';
import { THEMES, type ThemeName } from './tokens';

/**
 * The look this handset was told to wear, across restarts.
 *
 * Reported from the phone: *"when the user selects a color theme it doesn't
 * stick with a relaunch. I selected lamplight and shut the app down and when I
 * loaded the app again it was back on follow the device."*
 *
 * `ThemeProvider` said so itself — *"the override is session-scoped… persisting
 * a display preference belongs with the SQLite settings table, not here"* — so
 * the behaviour was known and the other half was never built. That reasoning is
 * right about the **lamp toggle**, which exists for the hour before sunrise when
 * the phone still thinks it is day and should not outlive the morning. It is
 * wrong about the row in Settings, which is somebody stating a preference.
 *
 * ## Why a file and not any of the places this app already writes
 *
 * **Not the site record**, where units and currency live. Those belong to the
 * *farm* — a weight is the same weight on every device, and a farm that reads
 * in kilogrammes reads in kilogrammes everywhere. A look belongs to the
 * **handset**: a tablet on a bright windowsill and a phone in a dark barn want
 * different answers, and syncing one to the other would be the app overruling
 * somebody who had already chosen.
 *
 * **Not SQLite.** The database is one file per org (invariant 6), and this has
 * to work before there is an org at all — D14 opens the app with no account and
 * supports staying that way. A device preference in a per-org database would be
 * forgotten by joining a farm and unreadable on the first run.
 *
 * **Not secure storage.** That is for tokens (invariant 6). A colour is not a
 * secret, and the Keystore is the slowest read on the device.
 *
 * So: one small JSON file in the document directory. `expo-file-system` is
 * already a dependency and already writes photos and exports through it, so
 * nothing is added.
 *
 * `Paths.document` rather than `Paths.cache`, for the reason `photos/store.ts`
 * gives: the cache is what the OS reclaims when it wants room, and a preference
 * that quietly resets when a phone fills up is the bug this file exists to fix,
 * arriving by a slower route.
 */

const FILE = 'device.json';

/**
 * `null` is a real, chosen value here and not an absence — it is "follow the
 * device", which is one of the three options the row offers. It has to survive
 * a restart exactly as the other two do, so it is stored rather than inferred
 * from the file being missing.
 */
const preferencesSchema = z.object({ look: z.string().nullable() }).partial();

/**
 * Checked against the theme table rather than a list written out again here.
 *
 * A fourth theme added to `tokens.ts` would otherwise be one this file quietly
 * refused to remember — a spelling mistake with no error, found only by
 * somebody choosing it and watching it not survive a restart. `THEMES` is
 * keyed by `ThemeName`, so it is the same source the renderer uses.
 */
function isThemeName(value: string): value is ThemeName {
  return Object.prototype.hasOwnProperty.call(THEMES, value);
}

export type Look = ThemeName | null;

function file(): File {
  return new File(Paths.document, FILE);
}

/**
 * What was chosen, or `undefined` when nothing has been.
 *
 * Three-way on purpose, because `null` already means "follow the device".
 * Anything unreadable — absent, truncated by a battery pull, written by a
 * version that shaped it differently — comes back `undefined` and the caller
 * falls back to the system. Parsed rather than cast, per invariant 11: this is
 * external data the moment it leaves memory.
 */
export async function readLook(): Promise<Look | undefined> {
  try {
    const handle = file();
    if (!handle.exists) return undefined;

    // `text()`, as `BackupScreen` reads a file. The sync variant exists on the
    // real module and nothing else here uses it — one way to read a file is
    // worth more than saving an await on a cold start.
    const parsed = preferencesSchema.safeParse(JSON.parse(await handle.text()));
    if (!parsed.success) return undefined;

    const { look } = parsed.data;
    // Absent and "follow the device" are different answers and stay that way.
    if (look === undefined) return undefined;
    if (look === null) return null;
    return isThemeName(look) ? look : undefined;
  } catch {
    // A preference is never worth a crash on a cold start. Following the
    // device is a correct-looking app; refusing to boot is not.
    return undefined;
  }
}

/**
 * Remembers a choice. Best effort, deliberately.
 *
 * A write that fails must not stop the theme changing on screen — the person
 * asked for lamplight and lamplight is what they get for this run, whether or
 * not the disk cooperated. Swallowing it here keeps that guarantee at the one
 * call site that matters.
 */
export async function writeLook(look: Look): Promise<void> {
  try {
    const handle = file();
    /**
     * `create` before `write`, as `ExportScreen` does it.
     *
     * The real module will not write to a file that does not exist, and the
     * in-memory double used by the tests creates one implicitly — so writing
     * without this passes every test here and silently never persists anything
     * on a handset, which is the bug this file was written to fix arriving
     * again wearing a hat.
     *
     * `overwrite` because there is one preference and the new one replaces it.
     */
    handle.create({ overwrite: true });
    handle.write(JSON.stringify({ look }));
  } catch {
    return;
  }
}
