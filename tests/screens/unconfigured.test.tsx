import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetApiBase } from '@homefarm/core/api';
import { configureApi, resetApiFault } from '../../apps/mobile/src/boot/config';
import { SyncChip } from '../../apps/mobile/src/components/SyncChip';
import { DiagnosticsScreen } from '../../apps/mobile/src/screens/DiagnosticsScreen';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';

/**
 * What a farm actually sees when the app has no server address.
 *
 * The old behaviour was a full-screen "Steading could not start", which is the
 * wrong answer for an offline-first app — `tests/unit/api-config.test.ts`
 * covers the boot half. This is the other side of that trade: having decided
 * to open anyway, the app owes somebody a plain statement that nothing is
 * syncing. Silence here would be worse than the crash was, because a farm
 * would keep logging for weeks believing it was reaching the server.
 */

beforeEach(async () => {
  await freshStore();
  resetApiFault();
  resetApiBase();
});

afterEach(() => {
  resetApiFault();
  resetApiBase();
});

describe('the chip', () => {
  it('says so, rather than reporting the ordinary offline story', async () => {
    configureApi(undefined);
    const screen = await mount(<SyncChip />);

    expect(screen.text()).toContain('Not set up');
    // "Saved" would be a lie: nothing has reached a server and nothing will.
    expect(screen.text()).not.toContain('Saved');

    screen.unmount();
  });

  it('goes back to normal once an address is configured', async () => {
    configureApi('http://10.0.2.2:3001');
    const screen = await mount(<SyncChip />);

    expect(screen.text()).not.toContain('Not set up');

    screen.unmount();
  });
});

describe('the screen the chip leads to', () => {
  it('explains the fault above the numbers it explains away', async () => {
    configureApi(undefined);
    const screen = await mount(<DiagnosticsScreen />);
    const text = screen.text();

    expect(text).toContain('no farm server');
    expect(text).toContain('EXPO_PUBLIC_API_URL');

    /**
     * Before the queue, not after. Every figure below it — nothing ever sent,
     * network connected — is explained by this one fact, and a person reading
     * them without it goes looking for a fault that is not there.
     */
    expect(text.indexOf('no farm server')).toBeLessThan(text.indexOf('The queue'));

    screen.unmount();
  });

  it('still leads with the reassurance', async () => {
    configureApi(undefined);
    const screen = await mount(<DiagnosticsScreen />);
    const text = screen.text();

    // The first thing on the screen is that the records are safe, and that
    // does not stop being first because a second thing is wrong.
    expect(text.indexOf('on this device')).toBeLessThan(text.indexOf('no farm server'));

    screen.unmount();
  });

  it('says nothing about it when the app is configured', async () => {
    configureApi('http://10.0.2.2:3001');
    const screen = await mount(<DiagnosticsScreen />);

    expect(screen.text()).not.toContain('no farm server');

    screen.unmount();
  });
});
