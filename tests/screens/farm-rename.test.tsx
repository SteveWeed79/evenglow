import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiBase, setAccessToken, setApiBase } from '@homefarm/core/api';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { seedSecureStore } from '../support/native/modules';
import { FarmName } from '../../apps/mobile/src/components/FarmName';

/**
 * Renaming the farm, and the four things that stop it happening by accident.
 *
 * The feature shipped with **no coverage at all** and lived on *Who is on your
 * farm* — a screen about people — as an editable box holding the live name with
 * an always-live commit beside it. One stray tap and one keystroke renamed the
 * farm for everybody on it.
 *
 * Asked directly: *"how do we secure it so it cannot happen on accident?"* The
 * answer is layered rather than a dialogue, because a single confirmation is
 * the guard people learn to tap through. Each layer gets an assertion here.
 */

const ORG = '01J000000000000000000ORG1';

function signedIn(role = 'owner', orgName = 'Hollow Farm'): void {
  seedSecureStore({
    'homefarm.refreshToken': 'a-stored-refresh-token',
    'homefarm.claims': JSON.stringify({ userId: 'u1', orgId: ORG, role, orgName }),
  });
}

/** Records every PATCH, which is the thing that must not happen unasked. */
function server(): { patches: unknown[] } {
  const patches: unknown[] = [];

  vi.stubGlobal('fetch', async (input: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'PATCH') {
      patches.push(init.body === undefined ? null : JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });

  return { patches };
}

beforeEach(async () => {
  await freshStore();
  setApiBase('http://farm.test');
  setAccessToken('an-access-token');
  signedIn();
});

afterEach(() => {
  resetApiBase();
  setAccessToken(null);
  vi.unstubAllGlobals();
});

describe('who may see it at all', () => {
  /** Guard 1. UX only — the server re-derives the role (invariant 8). */
  it('is not offered to a hand', async () => {
    signedIn('hand');
    const screen = await mount(<FarmName />);

    expect(screen.text()).not.toContain("The farm's name");
    expect(screen.has('farm-rename-open')).toBe(false);

    screen.unmount();
  });

  it('is offered to an owner', async () => {
    const screen = await mount(<FarmName />);

    expect(screen.has('farm-rename-open')).toBe(true);
    expect(screen.text()).toContain('Hollow Farm');

    screen.unmount();
  });

  /**
   * `useAccount` has three states — `undefined` for "not read yet", `null` for
   * "no account", claims for an account — and the component refuses the first
   * two. Only the second is observable here: the claims store is a module-level
   * cache and by the time a test can look at a tree it has already answered, so
   * an assertion about the not-read-yet frame would pass whatever the code did.
   *
   * The `null` half is a real device state and is asserted. Flattening the two
   * is the mistake this app has already made once, on the account panel, where
   * it flashed the wrong thing on every cold start.
   */
  it('shows nothing on a device with no account', async () => {
    seedSecureStore({});
    const screen = await mount(<FarmName />);

    expect(screen.has('farm-rename-open')).toBe(false);

    screen.unmount();
  });
});

describe('the field is not lying around', () => {
  /** Guard 2, and the one that answers the report most directly. */
  it('has no editable box until somebody asks for one', async () => {
    const screen = await mount(<FarmName />);

    expect(screen.has('farm-name')).toBe(false);

    await screen.press('farm-rename-open');
    expect(screen.has('farm-name')).toBe(true);

    screen.unmount();
  });

  it('puts it away again, forgetting what was typed', async () => {
    const screen = await mount(<FarmName />);

    await screen.press('farm-rename-open');
    await screen.type('farm-name', 'Something Else');
    await screen.press('farm-rename-cancel');

    expect(screen.has('farm-name')).toBe(false);

    // Re-opening starts from the real name, not from the abandoned draft.
    await screen.press('farm-rename-open');
    expect(screen.shows('farm-name')).toBe('Hollow Farm');

    screen.unmount();
  });
});

describe('nothing is sent unless the name actually changed', () => {
  /**
   * Guard 3. The old commit was live whenever the box was non-empty, so
   * opening the screen and pressing it re-sent the same name as a rename.
   */
  it('will not commit the name it already has', async () => {
    const { patches } = server();
    const screen = await mount(<FarmName />);

    await screen.press('farm-rename-open');
    await screen.press('farm-rename');
    await screen.press('farm-rename');

    expect(patches).toEqual([]);

    screen.unmount();
  });

  it('will not commit whitespace either', async () => {
    const { patches } = server();
    const screen = await mount(<FarmName />);

    await screen.press('farm-rename-open');
    await screen.type('farm-name', '   ');
    await screen.press('farm-rename');
    await screen.press('farm-rename');

    expect(patches).toEqual([]);

    screen.unmount();
  });

  /** A name that differs only by spaces is the same name. */
  it('treats a padded name as no change', async () => {
    const { patches } = server();
    const screen = await mount(<FarmName />);

    await screen.press('farm-rename-open');
    await screen.type('farm-name', '  Hollow Farm  ');
    await screen.press('farm-rename');
    await screen.press('farm-rename');

    expect(patches).toEqual([]);

    screen.unmount();
  });
});

describe('the commit takes two taps', () => {
  /**
   * Guard 4, and the assertion that matters is the FIRST tap: it must arm and
   * send nothing. A confirm that fires on the first press is not a confirm.
   */
  it('sends nothing on the first tap', async () => {
    const { patches } = server();
    const screen = await mount(<FarmName />);

    await screen.press('farm-rename-open');
    await screen.type('farm-name', 'Ridgeway Farm');
    await screen.press('farm-rename');

    expect(patches).toEqual([]);
    screen.unmount();
  });

  /** And the armed label reads out the destination rather than saying "sure?". */
  it('names the farm it is about to become', async () => {
    server();
    const screen = await mount(<FarmName />);

    await screen.press('farm-rename-open');
    await screen.type('farm-name', 'Ridgeway Farm');
    await screen.press('farm-rename');

    expect(screen.text()).toContain('Ridgeway Farm');
    expect(screen.labels()).toContain('Tap again to call it Ridgeway Farm');

    screen.unmount();
  });

  it('renames on the second, with the name trimmed', async () => {
    const { patches } = server();
    const screen = await mount(<FarmName />);

    await screen.press('farm-rename-open');
    await screen.type('farm-name', '  Ridgeway Farm  ');
    await screen.press('farm-rename');
    await screen.press('farm-rename');

    expect(patches).toEqual([{ name: 'Ridgeway Farm' }]);

    screen.unmount();
  });
});
