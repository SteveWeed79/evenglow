import { useEffect, useState } from 'react';
import { readCachedClaims } from '../auth/store';

/**
 * The farm's own name, for the screens that should say it.
 *
 * The app has collected a farm name since the first signup screen, stored it
 * in the claims cache, and never once shown it to the person who typed it.
 * Every screen a farmer opens first is generic — which is the whole of the
 * "it feels impersonal" complaint, in one missing read.
 *
 * ## Null is the ordinary case, not an error
 *
 * D14: the app opens with no account, no network and no server address, and
 * that is a supported permanent state rather than a setup step somebody has
 * not finished. A farm that never signs in has no `orgName` and must not be
 * shown a placeholder, a prompt, or the word "unnamed" — it is running
 * exactly as designed. Callers render nothing.
 *
 * ## Read once, like every other claim
 *
 * Same shape as `SettingsScreen`'s account read and for the same reason: this
 * gates display and nothing else (invariant 8), so the cost of a stale value
 * is one render of a farm's previous name after it is renamed, and the tree
 * remounts on sign-in and on joining a farm anyway.
 */
export function useFarmName(): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void readCachedClaims().then((claims) => {
      if (!live) return;
      // A farm named by the Google path with the field left blank is stored as
      // "My farm" — which is a name somebody accepted, so it is said like one.
      setName(claims?.orgName ?? null);
    });
    return () => {
      live = false;
    };
  }, []);

  return name;
}
