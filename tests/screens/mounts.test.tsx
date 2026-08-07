import { beforeEach, describe, expect, it } from 'vitest';
import { freshStore } from '../support/store';
import { mount } from '../support/screen';
import { SCREENS, stockTheFarm } from '../support/screens';

/**
 * Every screen renders something.
 *
 * The list and the fixture live in `tests/support/screens.tsx`, because the
 * affordance audit walks the same forty-five screens and two copies would
 * drift.
 */

describe('every screen mounts on an empty farm', () => {
  beforeEach(async () => {
    await freshStore();
  });

  for (const [name, render] of SCREENS) {
    it(name, async () => {
      const screen = await mount(render());
      // Something was drawn. A screen that renders nothing at all has either
      // thrown its content away or is stuck on a loading branch forever.
      expect(screen.text().trim().length).toBeGreaterThan(0);
      screen.unmount();
    });
  }
});

describe('every screen mounts on a stocked farm', () => {
  beforeEach(async () => {
    await freshStore();
    await stockTheFarm();
  });

  for (const [name, render] of SCREENS) {
    it(name, async () => {
      const screen = await mount(render());
      expect(screen.text().trim().length).toBeGreaterThan(0);
      screen.unmount();
    });
  }
});
