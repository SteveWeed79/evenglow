import { useCallback } from 'react';
import { Secondary } from '../components/Form';
import { useGoogleSignIn } from './google';

/**
 * The Google button, and the reason it is a component rather than a branch.
 *
 * `useGoogleSignIn` wraps `expo-auth-session`, which **throws during render**
 * when no client id is configured:
 *
 *   Client Id property `androidClientId` must be defined to use Google auth
 *   on this platform.
 *
 * `AccountScreen` used to call that hook itself and draw the button only when
 * a client id existed. Hooks cannot be conditional, so the call came first and
 * the guard came second — and the guard never ran, because the hook took the
 * screen down before it. Every build without a Google project met a red
 * error box on the one screen that leads to an account.
 *
 * A component *can* be conditional. The hook lives in here, this only exists
 * when `GOOGLE_AVAILABLE` says so, and an unconfigured build renders nothing
 * rather than crashing. Same rule, moved one level out to where it is legal.
 */
export function GoogleButton({
  disabled,
  onToken,
  label = 'Continue with Google',
  testID = 'account-google',
}: {
  disabled: boolean;
  /** The ID token, or null when the person backed out of the sheet. */
  onToken: (idToken: string | null) => void;
  /**
   * What the button says, because there are two of these now and they are not
   * doing the same thing. Signed out it continues into an account; signed in
   * it connects one to the account already open. Defaulted to the signed-out
   * wording so the original call site is unchanged.
   */
  label?: string;
  testID?: string;
}): React.ReactElement {
  const { prompt, ready } = useGoogleSignIn();

  const press = useCallback(() => {
    void prompt().then(onToken);
  }, [prompt, onToken]);

  return (
    <Secondary
      label={label}
      // `ready` is false while the auth request is still being prepared. A
      // button that silently does nothing for the first half-second is one
      // people tap twice.
      disabled={disabled || !ready}
      onPress={press}
      testID={testID}
    />
  );
}
