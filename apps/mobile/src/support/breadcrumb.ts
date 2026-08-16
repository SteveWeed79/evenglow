import { File, Paths } from 'expo-file-system';
import { z } from 'zod';
import { APP_BUILD, APP_VERSION } from '../version';

/**
 * What killed the app last time, read by the run that comes after it.
 *
 * `[40]`. The support screen is the way a farm tells anybody anything, and it
 * is **inside the tree that failed** — so the one crash class nobody could
 * report was the one that mattered most: the app dies on launch, the farmer
 * sees a white screen or a bounce back to the home screen, and every diagnostic
 * this project built is behind a tab they cannot reach.
 *
 * The trouble history in `hooks/useTrouble.ts` cannot answer this either, and
 * says so in its own words: it is *"one device across one run"*, held in module
 * state, and a crash ends the run. A crash report has to outlive the process
 * that produced it or it is not a crash report.
 *
 * ## A file, for the reasons `theme/look.ts` gives and one more
 *
 * Not SQLite: the database is one file per org (invariant 6), it may not be
 * open yet at the moment of a launch crash, and **it may be what crashed**. Not
 * secure storage, which is for tokens. One small JSON file in the document
 * directory, written through the dependency this app already writes photos,
 * exports and its theme with.
 *
 * `Paths.document` rather than `Paths.cache`: the OS reclaims the cache when it
 * wants room, and the phone that is crashing is disproportionately likely to be
 * the phone that is full.
 *
 * ## One crumb, not a log
 *
 * A crash loop would otherwise write a hundred of these, and the hundredth is
 * no more useful than the first. Each write replaces the last, and the read
 * clears it — so what a support bundle can carry is *the crash that happened
 * before this launch*, which is exactly the question being asked.
 */

const FILE = 'crash.json';

const breadcrumbSchema = z
  .object({
    /** In words — "drawing the app", not a stack frame. */
    where: z.string().max(120),
    message: z.string().max(2000),
    /** The first frames, when React gives us any. Trimmed hard: this is a crumb. */
    stack: z.string().max(4000).optional(),
    at: z.number().int(),
    version: z.string().max(40),
    build: z.string().max(40),
  })
  .strict();

export type Breadcrumb = z.infer<typeof breadcrumbSchema>;

function file(): File {
  return new File(Paths.document, FILE);
}

/**
 * Records a crash, and never throws while doing it.
 *
 * Called from a `componentDidCatch`, which is to say from inside a failure
 * that has already taken the screen. A breadcrumb writer that threw would
 * replace a legible crash with an illegible one, and the original — the
 * interesting one — would be gone.
 *
 * Written synchronously because the process may not survive to the next tick.
 * `expo-file-system`'s object API is sync, which is what makes this possible at
 * all; the legacy `writeAsStringAsync` would have lost the race it exists to
 * win.
 */
export function leaveBreadcrumb(where: string, error: unknown, componentStack?: string): void {
  try {
    /**
     * React's component stack when there is one, the JS stack otherwise.
     *
     * The component stack is the more useful of the two here by a distance: it
     * names the screen and the row, which is what identifies the defect, where
     * a minified JS stack off a release bundle names frames nobody can map.
     */
    const stack = componentStack ?? (error instanceof Error ? error.stack : undefined);

    const crumb: Breadcrumb = {
      where,
      message: error instanceof Error ? error.message : String(error),
      ...(typeof stack === 'string' ? { stack: stack.slice(0, 4000) } : {}),
      at: Date.now(),
      version: APP_VERSION,
      build: APP_BUILD,
    };

    const target = file();
    // `create` before `write`, and `overwrite` because there is one crumb —
    // `theme/look.ts` has the full argument: the real module will not write to
    // a file that does not exist, while the in-memory double the tests use
    // creates one implicitly, so writing without this passes here and persists
    // nothing on a handset.
    target.create({ overwrite: true });
    target.write(JSON.stringify(crumb));
  } catch {
    // The crash is the story; failing to write it down does not improve on it,
    // and throwing here would take the fallback screen with it.
  }
}

/**
 * The crash before this launch, if there was one. Reading it clears it.
 *
 * Clearing on read rather than on report: a crumb that survived being read
 * would attach itself to every ticket a farm ever files, and "the app crashed
 * once in March" stops being information the fourth time somebody sees it.
 *
 * Anything unreadable — truncated by the battery pull that accompanied the
 * crash, or written by a version that shaped it differently — comes back
 * `null` and is removed. Parsed, never cast (invariant 11).
 */
export async function takeBreadcrumb(): Promise<Breadcrumb | null> {
  try {
    const source = file();
    if (!source.exists) return null;

    // `text()` rather than the sync variant, as every other read in this app
    // does it. The write is the one that has to beat the process dying; the
    // read happens on a launch that is already going well.
    const text = await source.text();
    source.delete();

    const parsed = breadcrumbSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** One line for the trouble history, so a support bundle carries it. */
export function describeBreadcrumb(crumb: Breadcrumb): string {
  const when = new Date(crumb.at).toISOString();
  return `${crumb.message} (${crumb.version}+${crumb.build}, ${when})`;
}
