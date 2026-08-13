import { beforeEach, describe, expect, it } from 'vitest';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { AccountScreen } from '../../apps/mobile/src/screens/AccountScreen';

/**
 * The two basics a signup form has and this one did not.
 *
 * Both matter more here than on an ordinary site, for the same reason: **there
 * is no password reset in the app.** `pnpm db:password` needs a shell on the
 * server, so a password mistyped once at signup is a farm nobody can open —
 * with the records already sitting on the phone, which is the part that makes
 * it a data problem rather than an inconvenience.
 */

const signedOut = (): React.ReactElement => <AccountScreen onSignedIn={() => undefined} />;

beforeEach(async () => {
  await freshStore();
});

describe('seeing what you typed', () => {
  it('starts hidden, because it is still a password', async () => {
    const screen = await mount(signedOut());

    // The field is offered as a secret until somebody asks otherwise —
    // signing in at a market stall should not paint it on the screen.
    expect(screen.get('account-password').props.secureTextEntry).toBe(true);
    expect(screen.text()).toContain('Show');
    screen.unmount();
  });

  it('shows it when asked, and hides it again', async () => {
    const screen = await mount(signedOut());

    await screen.press('account-password-show');
    expect(screen.get('account-password').props.secureTextEntry).toBeFalsy();
    expect(screen.text()).toContain('Hide');

    await screen.press('account-password-show');
    expect(screen.get('account-password').props.secureTextEntry).toBe(true);
    screen.unmount();
  });

  /** One control for both boxes — checking one and not the other is no check. */
  it('reveals the confirmation with it', async () => {
    const screen = await mount(signedOut());
    await screen.pressLabel('Set up an account');

    await screen.press('account-password-show');
    expect(screen.get('account-password-confirm').props.secureTextEntry).toBeFalsy();
    screen.unmount();
  });
});

describe('typing it twice', () => {
  it('asks for it twice when the password is being created', async () => {
    const screen = await mount(signedOut());
    /**
     * Said rather than assumed. The screen opens on `claim` or `signin`
     * depending on whether this handset has records to keep, so a test about
     * the claim form has to ask for it — which is what the sign-in case below
     * has always done.
     */
    await screen.pressLabel('Set up an account');

    expect(screen.has('account-password-confirm')).toBe(true);
    screen.unmount();
  });

  it('does not ask twice to sign in', async () => {
    const screen = await mount(signedOut());
    await screen.pressLabel('Sign in');

    /**
     * The password already exists there, and a wrong one is reported straight
     * away. A second box would be asking somebody to prove they can type
     * something that is about to be checked for them anyway.
     */
    expect(screen.has('account-password-confirm')).toBe(false);
    screen.unmount();
  });

  it('will not submit until the two match', async () => {
    const screen = await mount(signedOut());
    await screen.pressLabel('Set up an account');

    await screen.type('account-farm', 'Hollow Farm');
    await screen.type('account-name', 'Sam');
    await screen.type('account-email', 'sam@example.com');
    await screen.type('account-password', 'a good long password');
    await screen.type('account-password-confirm', 'a good long passwrod');

    expect(screen.get('account-submit').props.disabled).toBe(true);
    expect(screen.text()).toContain('do not match');

    await screen.type('account-password-confirm', 'a good long password');
    expect(screen.get('account-submit').props.disabled).toBe(false);
    screen.unmount();
  });

  /** Half way through the second box is not a mistake yet. */
  it('says nothing while the second box is still empty', async () => {
    const screen = await mount(signedOut());

    await screen.type('account-password', 'a good long password');

    expect(screen.text()).not.toContain('do not match');
    // Still refused, though — silence is not permission.
    expect(screen.get('account-submit').props.disabled).toBe(true);
    screen.unmount();
  });

  it('holds the same gate on joining a farm', async () => {
    const screen = await mount(signedOut());
    await screen.pressLabel('Join a farm');

    await screen.type('account-code', 'K4M2QX');
    await screen.type('account-name', 'Sam');
    await screen.type('account-email', 'sam@example.com');
    await screen.type('account-password', 'a good long password');
    await screen.type('account-password-confirm', 'something else entirely');

    expect(screen.get('account-submit').props.disabled).toBe(true);
    screen.unmount();
  });
});
