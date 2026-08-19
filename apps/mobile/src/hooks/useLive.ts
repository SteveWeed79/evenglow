import { useCallback, useEffect, useState } from 'react';
import { subscribe } from '@homefarm/core/sync/engine';
import { clearTrouble, reportTrouble } from './useTrouble';

/**
 * A local read that keeps itself current.
 *
 * Every screen in this app renders the SQLite projection and nothing else, and
 * every one of them has to re-read when the engine publishes — after an
 * enqueue, after a flush, after a pull. That is the same six lines each time,
 * and writing it by hand is how a screen ends up with an initial fetch that
 * does not match its subscription and shows yesterday's list until something
 * else happens to touch the store.
 *
 * `null` means "not read yet", which is distinct from an empty list. The
 * difference matters: an empty list is indistinguishable from a farm with no
 * animals, and telling someone that while the database is still opening is
 * the most dangerous thing this app could say.
 *
 * `read` must be stable — a module-level function, or wrapped in `useCallback`
 * by the caller. An inline arrow resubscribes on every render.
 */
export function useLive<T>(read: () => Promise<T>, where = 'this screen'): T | null {
  const [value, setValue] = useState<T | null>(null);

  const refresh = useCallback(async () => {
    try {
      setValue(await read());
      clearTrouble();
    } catch (error) {
      // Stays null, so the caller keeps showing "not read yet" rather than an
      // empty list. `Screen` puts the reason on the wall.
      reportTrouble(where, error);
    }
  }, [read, where]);

  // subscribe() publishes immediately, so the subscription itself performs the
  // first read — no separate initial fetch to keep in step with it.
  useEffect(() => subscribe(() => void refresh()), [refresh]);

  return value;
}

/**
 * Two live reads at once, resolved together.
 *
 * Separate `useLive` calls would render the halves independently: a screen
 * showing a machine and its services would paint the machine first and the
 * services a frame later, which reads as the list appearing out of nowhere.
 */
export function useLive2<A, B>(
  readA: () => Promise<A>,
  readB: () => Promise<B>,
  where = 'this screen',
): [A, B] | null {
  const both = useCallback(
    async (): Promise<[A, B]> => Promise.all([readA(), readB()]),
    [readA, readB],
  );
  return useLive(both, where);
}
