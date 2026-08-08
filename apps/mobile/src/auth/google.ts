import { useCallback } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

/**
 * Google sign-in on the device (A2.4).
 *
 * One tap, nothing to type with a glove on, and no password for a farm to
 * store, reset or forget. The device runs the flow and comes away with an ID
 * token; `session.ts` hands that to the server, which is the only party that
 * verifies anything.
 *
 * ## Why `expo-auth-session` rather than the native Google SDK
 *
 * It replaces nothing — there was no Google path before — so the question
 * CLAUDE.md asks is whether a platform primitive would do. It would not: the
 * OAuth authorization-code-with-PKCE dance needs a system browser, a redirect
 * back into the app, and a `code_verifier` that never leaves the device.
 * Writing that by hand is writing a security protocol, and getting the PKCE
 * challenge subtly wrong is the kind of bug that still authenticates.
 *
 * `expo-auth-session` is Expo's own module and needs no config plugin, which
 * is the reason it is preferred to `@react-native-google-signin/google-signin`
 * here: the native SDK is a better experience and it wants a plugin, a
 * `google-services.json` and a prebuild step, all of which are things this
 * project cannot verify without a device in hand.
 *
 * ## Inert until it is configured
 *
 * The client ids arrive through `EXPO_PUBLIC_` variables, which Expo inlines
 * at build time. **They are public by design and invariant 12 is untouched** —
 * an OAuth client id ships in every OAuth app there has ever been, and the
 * native flow uses PKCE precisely so that no secret has to. With none set,
 * `available` is false and the button is not drawn: a farm running its own box
 * without a Google project sees email and password and nothing broken.
 */

/**
 * Required by `expo-auth-session`: closes the browser tab that the redirect
 * came back through. Module scope, because it has to run before any prompt.
 */
WebBrowser.maybeCompleteAuthSession();

const ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID ?? '';
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB ?? '';

/**
 * Whether this build has a Google project behind it, as a constant.
 *
 * **A constant rather than a field on the hook's result, and that is the whole
 * fix.** `useGoogleSignIn` used to answer this itself, on the reasoning that
 * hooks must be called unconditionally so `available` should gate the button
 * rather than the hook. The reasoning is sound about hooks and wrong about
 * this one: `useIdTokenAuthRequest` *throws* when no client id is configured —
 *
 *   Client Id property `androidClientId` must be defined to use Google auth
 *   on this platform.
 *
 * — so it never returns anything for a button to be gated on. The screen that
 * called it died on render, and it was `AccountScreen`, the only way into an
 * account. A farm running its own box without a Google project could not sign
 * in at all.
 *
 * Read this before rendering and the hook lives inside a component that only
 * exists when it is true — a conditional *component*, which is legal, rather
 * than a conditional hook, which is not.
 */
export const GOOGLE_AVAILABLE = ANDROID_CLIENT_ID !== '' || WEB_CLIENT_ID !== '';

export interface GoogleFlow {
  /** Runs the flow. Returns the ID token, or null if the person backed out. */
  prompt: () => Promise<string | null>;
  /** False while the request is still being prepared. */
  ready: boolean;
}

/**
 * **Only call this from inside a component guarded by `GOOGLE_AVAILABLE`.**
 *
 * `useIdTokenAuthRequest` throws rather than returning something inert when
 * there is no client id, so calling it in an unconfigured build takes the
 * whole screen down. `GoogleButton` is the guard; nothing else should call
 * this directly.
 */
export function useGoogleSignIn(): GoogleFlow {
  /**
   * The ID token flow rather than the access token one.
   *
   * An access token would mean the server calling Google to ask who the
   * bearer is — a network round trip inside a sign-in, and a second thing to
   * fail in a barn. An ID token is signed, so the server verifies it with keys
   * it already has cached. See `apps/api/src/auth/google.ts`.
   *
   * Called unconditionally within this hook, which is correct — what was
   * wrong was calling this hook itself from a screen that might not have a
   * client id. See `GOOGLE_AVAILABLE`.
   */
  const [request, , promptAsync] = Google.useIdTokenAuthRequest({
    ...(ANDROID_CLIENT_ID === '' ? {} : { androidClientId: ANDROID_CLIENT_ID }),
    ...(WEB_CLIENT_ID === '' ? {} : { webClientId: WEB_CLIENT_ID }),
  });

  const prompt = useCallback(async (): Promise<string | null> => {
    const result = await promptAsync();

    /**
     * Backing out is not an error.
     *
     * `dismiss` and `cancel` are somebody deciding not to, which happens on
     * every sign-in screen ever built and must not produce a red message. Only
     * a flow that came back claiming success without a token is worth a
     * complaint, and that is the one this returns null for silently too —
     * the screen says the plain sentence rather than guessing.
     */
    if (result.type !== 'success') return null;

    const idToken = result.params['id_token'];
    return typeof idToken === 'string' && idToken !== '' ? idToken : null;
  }, [promptAsync]);

  return { prompt, ready: request !== null };
}
