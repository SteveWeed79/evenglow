import { z } from 'zod';
import { apiBase } from '@homefarm/core/api';
import { isNewerVersion } from '@homefarm/contracts';
import { APP_VERSION, installsFromShelf } from '../version';

/**
 * Whether the box is serving a newer build than this one — `[23]`, phase 1.
 *
 * ## The problem this exists for
 *
 * **A sideloaded install has no updater.** A farm that installed from
 * `https://…/app/` will never be told by Android that there is a newer build,
 * so every fix shipped after that install is invisible until somebody happens
 * to mention it. The server-side floor (`MINIMUM_CLIENT_VERSION`) was the other
 * half of `[23]`/`[24]` and it only refuses; nothing ever offered.
 *
 * ## It asks the shelf, not the API
 *
 * `publish-apk.sh` writes `version.json` beside the install page, and Caddy
 * serves it from the same `/app/` block — matched before the reverse proxy, so
 * this adds no route and no byte to the API's surface. That is the same
 * argument the install page itself was built on.
 *
 * It is also the honest source: the shelf is what a farm would actually install
 * from, so the version it is serving is the version that can be had. Asking the
 * API would answer with what the *server* is running, which is a different
 * number and not the one somebody can act on.
 *
 * ## What it must not do
 *
 * **Not a wall.** The standard pattern blocks the app until it is updated; that
 * is wrong here and breaks D14 outright — this app's whole premise is that a
 * handset with no server still works. Sync is already held by the floor when a
 * server decides a build is too old, and nothing is dropped when it is. What
 * was missing was a banner that can be acted on, so this produces a sentence
 * and a link and nothing else.
 *
 * **Never a nag on Play.** See `installsFromShelf`: the box cannot answer for a
 * Play device, and Play's own policy forbids an app it distributed from
 * updating itself another way.
 *
 * **Silent on every failure.** Offline, no server configured, a box that has
 * never published, a malformed file — all of them mean "nothing to say", not an
 * error. A farm looking at the sync screen has enough to read.
 */

/**
 * What the shelf publishes about itself.
 *
 * `.passthrough()` rather than `.strict()`, which is the opposite of the rule
 * everywhere else in this app and is right here: this file is written by a
 * shell script on a box that may be running an older checkout than the handset,
 * and a field added to it next year must not make every installed app stop
 * noticing updates. The two fields that matter are read; anything else is
 * ignored rather than fatal.
 */
const shelfSchema = z
  .object({
    version: z.string().min(1).max(40),
    /** The Android versionCode, for the sentence rather than the comparison. */
    code: z.string().max(20).optional(),
  })
  .passthrough();

export interface ShelfUpdate {
  version: string;
  code: string | undefined;
}

/**
 * What this decision depends on, all of it injectable.
 *
 * **The channel and the version are build-time constants**, inlined into the
 * bundle by Expo's substitution — which is exactly right on a handset and
 * untestable from a suite, because a test cannot change a literal after import.
 * Threading them through as defaults costs one object and makes every branch
 * here reachable: a Play build, an unconfigured one, a box serving something
 * older, a box serving nonsense.
 *
 * That matters more than usual for this file. Every failure path returns the
 * same `null`, so a mistake in any of them is invisible — the banner simply
 * never appears, which looks identical to being up to date.
 */
export interface ShelfDeps {
  fetch?: typeof fetch;
  /** Whether this build may send somebody to the box. Defaults to the stamp. */
  fromShelf?: () => boolean;
  /** What this app is. Defaults to the version compiled into it. */
  current?: string;
}

/**
 * The newer build on the shelf, or null when there is nothing to say.
 */
export async function shelfUpdate(deps: ShelfDeps = {}): Promise<ShelfUpdate | null> {
  const fetcher = deps.fetch ?? fetch;
  const fromShelf = deps.fromShelf ?? installsFromShelf;
  const current = deps.current ?? APP_VERSION;

  // Asked before the request, so a Play build makes no call at all rather than
  // making one and discarding the answer.
  if (!fromShelf()) return null;

  const base = apiBase();
  if (base === null) return null;

  try {
    const res = await fetcher(`${base}/app/version.json`, {
      // The shelf sets no-cache, and this says the same from the other end: a
      // check for a newer build answered from a cache is not a check.
      headers: { 'cache-control': 'no-cache' },
    });
    if (!res.ok) return null;

    const parsed = shelfSchema.safeParse(await res.json());
    if (!parsed.success) return null;

    if (!isNewerVersion(parsed.data.version, current)) return null;

    return { version: parsed.data.version, code: parsed.data.code };
  } catch {
    // Offline, DNS, TLS, a box that has never published. None of it is a fault
    // a farmer can act on, and none of it belongs on this screen.
    return null;
  }
}

/** Where to send somebody who wants it. The page explains the warnings. */
export function shelfInstallUrl(): string | null {
  const base = apiBase();
  return base === null ? null : `${base}/app/`;
}
