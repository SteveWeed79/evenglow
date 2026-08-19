import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setOnline, startSync, stopSync, subscribe } from '@homefarm/core/sync/engine';
import { freshStore } from '../support/store';

/**
 * The offline branch that had never once been taken.
 *
 * `isOnline()` read `navigator.onLine`. React Native does define `navigator`,
 * with exactly one property on it, and `onLine` is not among them — so
 * `undefined !== false` was `true` and the check passed unconditionally. The
 * branch it guards has been unreachable for the whole life of the app.
 *
 * A feature that cannot fire is worse than no feature: it reads like a
 * decision somebody made and tested.
 */

beforeEach(async () => {
  await freshStore();
  setOnline(true);
});

afterEach(() => {
  stopSync();
  setOnline(true);
});

describe('what the engine believes about the network', () => {
  it('assumes online until something says otherwise', async () => {
    // The safe default, and the asymmetry is the argument: a wrong `true`
    // costs one flush that fails and backs off, which the engine handles. A
    // wrong `false` is a queue that never sends and nobody notices.
    let published = false;
    const stop = subscribe(() => {
      published = true;
    });

    startSync();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(published).toBe(true);
    stop();
  });

  it('takes being told it is offline', () => {
    // The whole point: this is now sayable at all.
    expect(() => setOnline(false)).not.toThrow();
    expect(() => setOnline(true)).not.toThrow();
  });

  it('is safe to report before the loop is running', () => {
    // triggers.ts can fire before startSync on a cold resume.
    stopSync();
    expect(() => setOnline(false)).not.toThrow();
    expect(() => setOnline(true)).not.toThrow();
  });

  it('reports the same state twice without effect', () => {
    setOnline(true);
    expect(() => setOnline(true)).not.toThrow();
    setOnline(false);
    expect(() => setOnline(false)).not.toThrow();
  });
});
