import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActiveWithdrawal, NOT_VETERINARY_ADVICE } from '@homefarm/contracts';
import { seedSecureStore } from '../support/native/modules';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { WithdrawalBanner } from '../../apps/mobile/src/components/WithdrawalBanner';
import { SettingsScreen } from '../../apps/mobile/src/screens/SettingsScreen';

/**
 * "Not veterinary advice", and the two places it has to be — `[16]`.
 *
 * A disclaimer is the kind of thing that gets written, agreed, and then lands
 * in one of the two places it was meant for. The banner is the one that would
 * be dropped, because it is fiddly and Settings feels like where a disclaimer
 * belongs — and the banner is the half that does the work: it is the screen
 * somebody is looking at when they decide whether to sell.
 *
 * So both placements are asserted, and asserted against the **same constant**.
 * Two hand-written wordings would drift, and the one that drifted would be the
 * banner's.
 */

const WITHHELD: ActiveWithdrawal = {
  kind: 'egg',
  medicationId: '01J0000000000000000000000A',
  medication: 'Baytril',
  subjectId: '01J0000000000000000000000B',
  clearsAt: Date.now() + 5 * 86_400_000,
};

/** An open course, which says something quite different above the line. */
const OPEN: ActiveWithdrawal = { ...WITHHELD, clearsAt: null };

beforeEach(async () => {
  await freshStore();
  seedSecureStore({
    'homefarm.claims': JSON.stringify({
      userId: '01J0000000000000000000000C',
      orgId: '01J0000000000000000000000D',
      role: 'owner',
      name: 'The keeper',
      orgName: 'Hollow Farm',
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 204 })));
});

describe('the withdrawal band', () => {
  /**
   * The placement that matters. Somebody reading this band is deciding whether
   * to sell eggs, and that is the moment the caveat applies.
   */
  it('carries the line under the withheld message', async () => {
    const screen = await mount(<WithdrawalBanner withdrawal={WITHHELD} />);

    // The warning still leads — the caveat must not have replaced it.
    expect(screen.text()).toContain('Baytril');
    expect(screen.text()).toContain(NOT_VETERINARY_ADVICE);

    screen.unmount();
  });

  /**
   * An open course is the case where the app has no date at all and says so.
   * It is also the case where somebody is most likely to go looking for a
   * number, so the line has to be there too.
   */
  it('carries it on an open course as well', async () => {
    const screen = await mount(<WithdrawalBanner withdrawal={OPEN} />);

    expect(screen.text()).toContain('record the last dose');
    expect(screen.text()).toContain(NOT_VETERINARY_ADVICE);

    screen.unmount();
  });

  /**
   * It names where the date came from, which is the half that is worth saying.
   * "Not veterinary advice" alone is the boilerplate everybody scrolls past;
   * the useful fact is that the app did arithmetic on what somebody typed.
   */
  it('says the date was worked out from what was typed in', async () => {
    const screen = await mount(<WithdrawalBanner withdrawal={WITHHELD} />);

    expect(screen.text()).toContain('worked out from what was typed in');
    expect(screen.text()).toContain("medicine's label");

    screen.unmount();
  });
});

describe('Settings', () => {
  /**
   * The other placement, for the farm that has never treated an animal and so
   * has never seen the band.
   */
  it('carries the same line, word for word', async () => {
    const screen = await mount(<SettingsScreen onSignedOut={() => undefined} />);
    await screen.settle();

    expect(screen.text()).toContain(NOT_VETERINARY_ADVICE);

    screen.unmount();
  });
});
