import { useAccount } from './useAccount';

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
 * ## Watched, not read once
 *
 * This used to read the claims cache in a mount effect and keep the answer,
 * on the argument that *the tree remounts on sign-in and on joining a farm
 * anyway*. True, and it left out the direction that does not remount: signing
 * **out**, after which every screen already standing went on saying the name of
 * a farm this device was no longer signed in to, until the app was restarted.
 */
export function useFarmName(): string | null {
  const account = useAccount();

  // A farm named by the Google path with the field left blank is stored as
  // "My farm" — which is a name somebody accepted, so it is said like one.
  return account?.orgName ?? null;
}
