import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the weather row says BEFORE the store has answered.
 *
 * Its own file because `vi.mock` is hoisted and file-scoped, and this needs a
 * read that never resolves — which nothing else here wants.
 *
 * ## The third instance of one shape
 *
 * `useLive` returns `null` for a read in flight, and a component that flattens
 * that into "there is nothing" has promised something it does not know. My Farm
 * waited for ever on a read that had already answered; the photo strip told
 * people their photos were gone for the beat before SQLite came back.
 *
 * The forecast is the third and worst chance to get it wrong, because it is
 * genuinely nullable: there IS no weather for a farm that has not said where it
 * is. Flattening the two would show *"Say where the farm is"* to a farm that
 * already has, every single time the app opened — an invitation to redo work
 * they had done.
 *
 * So `useWeather` reports `loading` explicitly instead of leaning on null, and
 * this holds the read open to prove the row keeps quiet while it is in flight.
 */

const held = { release: (() => undefined) as () => void };

vi.mock('@steading/core/weather', () => ({
  readWeather: () =>
    new Promise((resolve) => {
      held.release = () => resolve(null);
    }),
  readObservation: async () => null,
  readAlerts: async () => [],
  refreshWeather: async () => ({ weather: null }),
  refreshObservation: async () => null,
  refreshAlerts: async () => [],
  forgetWeather: async () => undefined,
  // Held at "nothing to ask for", so this test is about the read alone.
  wouldFetch: () => false,
  wouldFetchObservation: () => false,
  wouldFetchAlerts: () => false,
  MIN_GAP_MS: 3_600_000,
  OBSERVATION_GAP_MS: 600_000,
  ALERTS_GAP_MS: 900_000,
}));

const { enqueue } = await import('@steading/core/sync/queue');
const { newId } = await import('@steading/contracts');
const { freshStore } = await import('../support/store');
const { mount } = await import('../support/screen');
const { TodayScreen } = await import('../../apps/mobile/src/screens/TodayScreen');

beforeEach(async () => {
  await freshStore();
  await enqueue({
    entity: 'site',
    op: 'create',
    targetId: newId(),
    payload: { name: 'The farm', lat: 44.48, lon: -73.21 },
  });
});

describe('the weather row, mid-read', () => {
  it('draws nothing at all rather than inviting a farm that has already answered', async () => {
    const today = await mount(<TodayScreen />);

    // The read is still open, so the row must not answer the question either
    // way — no invitation, and no claim that there is no forecast.
    expect(today.has('weather-row')).toBe(false);
    expect(today.text()).not.toContain('Say where the farm is');
    expect(today.text()).not.toContain('No forecast yet');

    // The rest of Today is not held up waiting for the weather.
    expect(today.text()).toContain('Nothing to log yet');

    held.release();
    await today.settle();

    // And once the cache has answered, it says what it found.
    expect(today.has('weather-row')).toBe(true);
    expect(today.text()).toContain('No forecast yet');
    today.unmount();
  });
});
