import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiBase, setApiBase } from '@steading/core/api';
import { listTickets, pendingTickets } from '@steading/core/support/tickets';
import { shared } from '../support/native/react-native';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { resetTrouble } from '../../apps/mobile/src/hooks/useTrouble';
import { SupportScreen } from '../../apps/mobile/src/screens/SupportScreen';

/**
 * Telling somebody the app is wrong, from the screen (`docs/SUPPORT-LOOP.md`).
 *
 * Two properties are load-bearing and neither is visible from the modules
 * underneath:
 *
 *  - **The consent question defaults to no**, and nothing on this screen can
 *    send a farm's records without somebody having answered it (S2).
 *  - **The second door is beside the first, not behind its failure** (S7). A
 *    farm whose sync has been broken for a week must not have to press the
 *    button that will not work in order to earn the one that will.
 */

const BASE = 'https://farm.test';

/** A barn with no signal, which is where most of these are written. */
function noSignal(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (): Promise<Response> => {
      throw new TypeError('Network request failed');
    }),
  );
}

function serverTakesIt(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (): Promise<Response> =>
        new Response(JSON.stringify({ ok: true, url: 'https://github.test/issues/1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

beforeEach(async () => {
  await freshStore();
  resetTrouble();
  setApiBase(BASE);
  shared.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiBase();
});

describe('what the screen asks for', () => {
  /**
   * S1: almost nothing here is typed. The queue depth, the schema version and
   * the engine's own errors are already on the device and are a better
   * artefact than steps to reproduce written by somebody holding a bucket.
   */
  it('asks for nothing and says so', async () => {
    const screen = await mount(<SupportScreen />);

    expect(screen.text()).toContain('nothing here you have to fill in');
    expect(screen.has('support-send')).toBe(true);
  });

  it('offers the other way out beside the ordinary one, not behind its failure', async () => {
    const screen = await mount(<SupportScreen />);

    expect(screen.has('support-share')).toBe(true);
  });

  it('sends a report with nothing typed at all', async () => {
    serverTakesIt();
    const screen = await mount(<SupportScreen />);

    await screen.press('support-send');

    const [sent] = await listTickets();
    expect(sent?.sentAt).toBeGreaterThan(0);
    expect(screen.text()).toContain('That is filed');
  });
});

/**
 * The question the farm is asked, and the answer that must never be assumed.
 *
 * > "Do you want to send your farm data along with the ticket to help develop
 * > the correction?"
 */
describe('the consent question', () => {
  it('is asked here rather than buried in a setting', async () => {
    const screen = await mount(<SupportScreen />);

    expect(screen.text()).toContain("Send your farm's records too?");
  });

  it('sends no records unless somebody said yes', async () => {
    serverTakesIt();
    const screen = await mount(<SupportScreen />);

    await screen.press('support-send');

    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => String(init?.body));
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0] ?? '{}').records).toBeUndefined();
  });

  it('sends them when it is answered, and says how much that is first', async () => {
    serverTakesIt();
    const screen = await mount(<SupportScreen />);

    await screen.press('support-records');
    // The size is on the toggle before the answer counts: somebody agreeing to
    // send their farm's records is entitled to know whether that is forty
    // kilobytes or four megabytes.
    expect(screen.text()).toMatch(/Send my records with this — \d+(\.\d)? (KB|MB)/);

    await screen.press('support-send');

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body)).records).toContain('sheets');
  });
});

describe('when it cannot go', () => {
  /**
   * R6, and the promise the whole queue makes: the press succeeds whether or
   * not there is signal. What the screen reports afterwards is where the
   * report got to, never whether it was recorded.
   */
  it('keeps the report and says so, rather than losing it', async () => {
    noSignal();
    const screen = await mount(<SupportScreen />);

    await screen.press('support-send');

    expect(await pendingTickets()).toHaveLength(1);
    expect(screen.text()).toContain('Kept on this phone');
  });

  it('offers what is waiting and lets it be tried again', async () => {
    noSignal();
    const screen = await mount(<SupportScreen />);
    await screen.press('support-send');

    expect(screen.text()).toContain('One report waiting');

    serverTakesIt();
    const [held] = await pendingTickets();
    await screen.press(`ticket-${held?.id}`);

    expect(await pendingTickets()).toHaveLength(0);
  });

  /**
   * The share sheet needs no server, no account and no signal beyond whatever
   * the app it is shared into uses — which is the entire point: this is the
   * path that works when `POST /support` is the thing that is broken.
   */
  it('shares the same report out through the OS instead', async () => {
    noSignal();
    const screen = await mount(<SupportScreen />);
    await screen.press('support-send');

    await screen.press('support-share');

    expect(shared).toHaveLength(1);
    const [held] = await pendingTickets();
    // The one that was queued, not a second near-identical report with a
    // different timestamp that nobody could tell was the same event.
    expect(shared[0]).toContain(JSON.parse(String(held?.bundle)).fingerprint);
  });

  it('shares without anything having been queued first', async () => {
    const screen = await mount(<SupportScreen />);

    await screen.press('support-share');

    expect(shared).toHaveLength(1);
    expect(await pendingTickets()).toHaveLength(0);
  });

  /**
   * **The answer goes under the button that asked for it.**
   *
   * Reported from a handset as pressing Send and nothing happening whatsoever
   * — on the morning the answer was *this server has nowhere to file a
   * report*. The app had said exactly that, in a panel rendered above the
   * actions, off the top of a screen whose primary button is in the bottom
   * third by R3. A verdict nobody can see is a verdict the app did not give.
   *
   * Asserted on reading order rather than left to the eye, because the fault
   * is invisible on any screen short enough to fit — which is every screen a
   * component test would otherwise be written against.
   */
  it('puts the verdict below the button rather than off the top of the screen', async () => {
    noSignal();
    const screen = await mount(<SupportScreen />);

    await screen.press('support-send');

    const read = screen.text();
    expect(read).toContain('Kept on this phone');
    expect(read.indexOf('Kept on this phone')).toBeGreaterThan(read.indexOf('Send this report'));
  });

  /** Success is read in the same glance, and had the same problem. */
  it('puts a filed report below the button too', async () => {
    serverTakesIt();
    const screen = await mount(<SupportScreen />);

    await screen.press('support-send');

    const read = screen.text();
    expect(read).toContain('That is filed');
    expect(read.indexOf('That is filed')).toBeGreaterThan(read.indexOf('Send this report'));
  });

  /**
   * The copy points at the other door, and the door moved when the panel did.
   * "below" was true when the verdict sat above the buttons and became a wrong
   * direction the moment it did not.
   */
  it('points at the share button in the direction it is actually in', async () => {
    noSignal();
    const screen = await mount(<SupportScreen />);

    await screen.press('support-send');

    expect(screen.text()).toContain('just above');
  });
});

/**
 * What the box does after a press.
 *
 * Reported from a handset: the words stay after a successful send, so the next
 * press files them again — a duplicate report of a fault nobody re-encountered,
 * which is the flood dedup exists to prevent arriving through the front door.
 */
describe('the free-text line', () => {
  it('is emptied once the report has actually gone', async () => {
    serverTakesIt();
    const screen = await mount(<SupportScreen />);

    await screen.type('support-said', 'The egg total looked wrong');
    await screen.press('support-send');

    expect(screen.shows('support-said')).toBe('');
  });

  /**
   * Kept on a failure. The report is on the phone rather than filed, the panel
   * says so, and clearing the box under it would look like the words went too.
   */
  it('keeps them when the report could not go', async () => {
    noSignal();
    const screen = await mount(<SupportScreen />);

    await screen.type('support-said', 'The egg total looked wrong');
    await screen.press('support-send');

    expect(screen.shows('support-said')).toBe('The egg total looked wrong');
  });
});
