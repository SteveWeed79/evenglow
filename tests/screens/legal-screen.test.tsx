import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '@homefarm/contracts';
import { seedSecureStore } from '../support/native/modules';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { LegalScreen } from '../../apps/mobile/src/screens/LegalScreen';
import { SettingsScreen } from '../../apps/mobile/src/screens/SettingsScreen';

/**
 * The policy and the terms, read on the handset.
 *
 * **The reason they are in the app at all is the thing to test.** D14 makes a
 * build with no server an ordinary state, so a farm must be able to read what it
 * agreed to with nothing configured — and these tests run with no API base and
 * no network, which is exactly that farm.
 */

beforeEach(async () => {
  await freshStore();
  seedSecureStore({});
  // Nothing here may reach the network. A fetch would be a defect.
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('a document must not need the network');
  }));
});

describe.each([
  ['privacy policy', PRIVACY_POLICY],
  ['terms of service', TERMS_OF_SERVICE],
])('the %s screen', (_name, document) => {
  it('renders offline, with its title and date', async () => {
    const screen = await mount(<LegalScreen document={document} />);
    await screen.settle();

    expect(screen.text()).toContain(document.effective);
    screen.unmount();
  });

  it('renders every block, not just the first few', async () => {
    const screen = await mount(<LegalScreen document={document} />);
    await screen.settle();

    const rendered = screen.text();
    for (const block of document.blocks) {
      if (block.kind === 'heading' || block.kind === 'paragraph') {
        expect(rendered, `missing: ${block.text.slice(0, 40)}`).toContain(block.text);
      }
      if (block.kind === 'list') {
        for (const item of block.items) {
          expect(rendered, `missing item: ${item.slice(0, 40)}`).toContain(item);
        }
      }
    }

    screen.unmount();
  });

  /** The address is selectable text rather than a link — see the screen. */
  it('shows the contact address', async () => {
    const screen = await mount(<LegalScreen document={document} />);
    await screen.settle();

    const contact = document.blocks.find((block) => block.kind === 'contact');
    expect(contact).toBeDefined();
    if (contact?.kind === 'contact') expect(screen.text()).toContain(contact.email);

    screen.unmount();
  });
});

describe('Settings', () => {
  /**
   * The way in. Both documents were reachable at a URL before they were
   * reachable in the app, which is the wrong way round for a farm with no
   * server.
   */
  it('offers both documents', async () => {
    const screen = await mount(<SettingsScreen onSignedOut={() => undefined} />);
    await screen.settle();

    expect(screen.has('go-privacy')).toBe(true);
    expect(screen.has('go-terms')).toBe(true);

    screen.unmount();
  });
});
