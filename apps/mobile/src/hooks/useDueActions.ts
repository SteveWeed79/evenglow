import { useCallback } from 'react';
import type { Due } from '@steading/contracts';
import { useNav } from './useNav';
import { useLog } from './useSync';
import { reportTrouble } from './useTrouble';
import type { RootParamList } from '../navigation/Root';

/**
 * What a due row does when it is tapped, and what its Done button writes.
 *
 * ## Why this left `TodayScreen`
 *
 * Both halves were written there, when Today was the only screen that drew a
 * due row. `Coming` draws them too now, and a routing table with two copies is
 * a table that drifts — the reason `HistoryScreen` extracted its rows before
 * `Timeline` reused them, stated on that file as *"taking a record back has to
 * behave identically whichever container it happens to be in."*
 *
 * The drift here would be quieter and worse. `due-routing.test.tsx` exists
 * because `openDue` read `subject.entity` first and sent every flock row to the
 * group screen — including one that passed an animal's id into a `groupId` slot
 * and rendered "That group — Missing" on a live row. A second copy of that map
 * is a second place for exactly that class of fault to reappear, and it would
 * reappear on a screen with no test walking every kind.
 */

/**
 * Where a row is discharged, as a destination rather than a jump.
 *
 * Named rather than performed so a caller can ask *would this go where I
 * already am* before offering the tap. A service row on the machine's own
 * screen resolves to that machine, and a chevron that reloads the screen
 * somebody is standing on is worse than no chevron: it reads as a door.
 */
export type DueDestination =
  | { screen: 'Incubation'; params: { incubationId: string } }
  | { screen: 'Weigh'; params: { groupId: string } }
  | { screen: 'Shearing'; params: { groupId: string } }
  | { screen: 'Breeding'; params: { groupId: string } }
  | { screen: 'Group'; params: { groupId: string } }
  | { screen: 'Machine'; params: { machineId: string } }
  | { screen: 'Planting'; params: { plantingId: string } };

/**
 * A due row says what is wanted; this says where it happens.
 *
 * `subject` is already on every `Due` for exactly this.
 *
 * ## Kind before entity, and why the order was wrong
 *
 * This read `subject.entity` first and sent every flock row to the group
 * screen. That is a hub, not a destination: a row whose whole content is a
 * weight, or a fleece, landed on a summary and made somebody find the action
 * among eight others and tap again. The row already knew what was wanted — the
 * app made the person say it a second time.
 *
 * So the kinds that name one act go straight to it, and `entity` is the
 * fallback for the rows that genuinely are "go and look at this thing".
 */
export function dueDestination(due: Due): DueDestination | null {
  const { entity, id } = due.subject;

  if (due.kind === 'candle' || due.kind === 'hatch') {
    return { screen: 'Incubation', params: { incubationId: id } };
  }

  /**
   * A row about weight opens the scale; a row about fleece opens the shearing
   * form; a birth opens the breeding book.
   *
   * "Roasters reach processing weight" asks one question and there is exactly
   * one way to answer it. Landing on the group screen made somebody read a
   * summary, find "Weigh them" among eight other rows and tap again — for a row
   * whose entire content is a weight. The same was true of the clip.
   */
  if (due.kind === 'processing') return { screen: 'Weigh', params: { groupId: id } };
  if (due.kind === 'shearing') return { screen: 'Shearing', params: { groupId: id } };
  if (due.kind === 'birth') return { screen: 'Breeding', params: { groupId: id } };
  if (entity === 'flock') return { screen: 'Group', params: { groupId: id } };

  /**
   * No builder produces an animal subject any more, and this stays
   * deliberately.
   *
   * `birthDue` did, and the old branch passed that animal's id into `Animals`
   * as a `groupId` — which found no group and rendered "That group — Missing".
   * A dead end on a live row. The due carries the dam's GROUP now (and names
   * her in `about`, which is how her own screen finds it), so it never reaches
   * here.
   *
   * Kept because the trap is in the shape rather than in that one builder:
   * `Animals` takes a groupId, an animal id is the same kind of string, and
   * nothing would complain. If a future due really is about one animal, it must
   * carry the group it lives in — not be routed by id shape and hope.
   */
  if (entity === 'animal') return null;
  if (entity === 'equipment') return { screen: 'Machine', params: { machineId: id } };
  if (entity === 'planting') return { screen: 'Planting', params: { plantingId: id } };

  // A withdrawal names the medication and there is no medication screen — the
  // group's banner is where it is read, and the row says which group.
  return null;
}

/**
 * The tap, if there is one worth offering.
 *
 * `here` is the route the rows are being drawn on, when they are drawn
 * somewhere other than Today. A destination that matches it is dropped rather
 * than navigated to.
 *
 * Any route name, not only the seven a due can resolve to. A screen knows what
 * it is; whether that happens to be somewhere a row could have sent you is the
 * map's business, and a bed naming itself today should not have to be revisited
 * the first time something is due for a bed.
 */
export function useOpenDue(): (due: Due, here?: keyof RootParamList) => (() => void) | undefined {
  const nav = useNav();

  return useCallback(
    (due, here) => {
      const to = dueDestination(due);
      if (to === null || to.screen === here) return undefined;

      // Switched rather than spread, because `navigate` pairs each route name
      // with its own params type and only the narrowed branch proves the pair.
      return () => {
        switch (to.screen) {
          case 'Incubation':
            nav.navigate(to.screen, to.params);
            return;
          case 'Weigh':
            nav.navigate(to.screen, to.params);
            return;
          case 'Shearing':
            nav.navigate(to.screen, to.params);
            return;
          case 'Breeding':
            nav.navigate(to.screen, to.params);
            return;
          case 'Group':
            nav.navigate(to.screen, to.params);
            return;
          case 'Machine':
            nav.navigate(to.screen, to.params);
            return;
          case 'Planting':
            nav.navigate(to.screen, to.params);
            return;
        }
      };
    },
    [nav],
  );
}

/**
 * Writes the record the row was waiting for, which is what clears it.
 *
 * **Not a completion flag** — see `Due.done`. This enqueues the same `careLog`
 * the form would have written, so the row disappears on the next recomputation
 * because the record now exists, and the job shows up in What happened. There
 * is still nothing anywhere that stores "done".
 */
export function useFinishDue(): (due: Due) => (() => void) | undefined {
  const log = useLog();

  return useCallback(
    (due) => {
      const done = due.done;
      if (done === undefined) return undefined;

      return () => {
        /**
         * A failed write is said out loud, not dropped.
         *
         * This was `void log(...)` with nothing after it, so a refused mutation
         * vanished and the row simply came back — indistinguishable from never
         * having pressed the button, which is exactly the report that led here.
         * The press is fire-and-forget by design (R6: a log is bounded by one
         * SQLite transaction, never by signal), but fire-and-forget must still
         * mean somebody hears about a fire that did not light.
         */
        void log({
          entity: done.entity,
          op: done.op,
          // A create mints its own id; an update names the row it changes.
          ...(done.targetId === undefined ? {} : { targetId: done.targetId }),
          payload: { ...done.payload, [done.stampAs]: Date.now() },
        }).catch((error: unknown) => reportTrouble(`recording ${done.label.toLowerCase()}`, error));
      };
    },
    [log],
  );
}
