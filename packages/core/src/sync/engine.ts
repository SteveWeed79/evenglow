import { localStore } from '../db/store';
import { reportEngineError } from './report';
import { backoffDelay, flushOnce, type SyncTransport } from './flush';
import { SYNC_LOCK, withSyncLock } from './lock';
import { transferPhotos } from './photos';
import { pullOnce, pulledThrough } from './pull';
import { checkIntegrity, queueDepth, rejectedCount } from './queue';

/**
 * Drives the flush loop.
 *
 * Nothing here blocks a log path (R6). The engine reacts to connectivity and
 * to new work; the UI never awaits it.
 */

export type SyncState =
  | { kind: 'synced'; at: Date | null }
  | { kind: 'queued'; count: number }
  | { kind: 'syncing'; count: number }
  | { kind: 'rejected'; count: number };

type Listener = (state: SyncState) => void;

/** How long to stand off when another tab holds the sync lock. */
const LOCK_HELD_MS = 1_000;

/** The resting cadence, when there is nothing queued and nothing failing. */
const IDLE_MS = 30_000;

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;
let running = false;
let syncing = false;

/**
 * Registers a listener and gives it a first state to work from.
 *
 * **The newcomer only.** This used to call `publish()`, which walks every
 * listener — so subscribing woke all of them, and a screen with five `useLive`
 * hooks did twenty-five reads on mount instead of five.
 *
 * That was waste. What made it a defect is `useLive`: its reader may be a
 * `useCallback` whose deps come from another `useLive`'s result, and those
 * results are freshly built objects. Waking every listener on subscribe then
 * closes a cycle — B re-reads, hands back a new object, A's reader changes
 * identity, A resubscribes, which wakes B. The render loop never settles and
 * the screen hangs with no error to point at.
 *
 * `TrendScreen` is the first screen to derive a reader from another read and
 * it hung on mount, which is how this surfaced. A new subscriber has no claim
 * on anybody else's state; the ones already listening have current values
 * already.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);

  void currentState().then(
    (state) => {
      // It may have unsubscribed while the read was in flight — a screen that
      // mounts and leaves inside one tick, which navigation does.
      if (listeners.has(listener)) listener(state);
    },
    (error: unknown) => reportEngineError('subscribe', error),
  );

  return () => listeners.delete(listener);
}

/**
 * Rejections outrank a queue: a farmer needs to know something needs a look
 * more than they need to know work is pending.
 */
async function currentState(): Promise<SyncState> {
  const [queued, rejected] = await Promise.all([queueDepth(), rejectedCount()]);

  if (rejected > 0) return { kind: 'rejected', count: rejected };
  if (syncing) return { kind: 'syncing', count: queued };
  if (queued > 0) return { kind: 'queued', count: queued };

  // Through the port, like everything else. Read directly from IndexedDB this
  // said "Saved" with no time on a device that had synced, because it was
  // asking a database the app had never written to.
  const at = await localStore().getLastSyncAt();
  return { kind: 'synced', at: at === null ? null : new Date(at) };
}

async function publish(): Promise<void> {
  const state = await currentState();
  for (const listener of listeners) listener(state);
}

/**
 * Whether the device believes it has a network, as last reported.
 *
 * `navigator.onLine` used to answer this, and on a handset it does not exist —
 * so `undefined !== false` was `true`, the check passed unconditionally, and
 * the offline branch of `tick()` below has never once been taken. A feature
 * that cannot fire is worse than no feature: it reads like a decision somebody
 * made and tested.
 *
 * Told rather than detected, matching `setEngineReporter` and `setApiBase`.
 * Core cannot ask a native module — `packages/core` compiles for a server too —
 * so the platform pushes the answer in. `apps/mobile/src/sync/triggers.ts`
 * already listens to expo-network for its regain trigger and now reports it
 * here as well.
 *
 * **Defaults to online, and stays online if nothing ever tells it otherwise.**
 * The cost of a wrong `true` is one flush that fails and backs off, which the
 * engine already handles correctly. The cost of a wrong `false` is a queue that
 * never sends. Only one of those is recoverable without a person noticing.
 */
let online = true;

export function setOnline(next: boolean): void {
  const changed = online !== next;
  online = next;

  // Regaining the network is worth acting on immediately: somebody who has
  // walked back into signal is usually looking at the sync chip.
  if (changed && next && running) {
    consecutiveFailures = 0;
    schedule(0);
  }
}

function isOnline(): boolean {
  return online;
}

/** Runs one flush and schedules the next. Never throws to the caller. */
async function tick(transport?: SyncTransport): Promise<void> {
  if (!running) return;

  if (!isOnline()) {
    schedule(IDLE_MS, transport);
    await publish();
    return;
  }

  // Push first, then pull. Flushing before hydrating means local work is
  // already on the server when the log comes back, so it returns as a record
  // this device recognises rather than as a surprise.
  if ((await queueDepth()) === 0) {
    await pull();

    /**
     * Photo bytes move on the idle tick, and only there.
     *
     * An empty queue is the one moment this device is certain every metadata
     * record it holds has reached the server — which is what a PUT needs, since
     * bytes for a photo the server has never heard of are a 404. It is also
     * when there is bandwidth going spare.
     *
     * Never inside the flush: twenty-five megabytes of JPEG must not be able
     * to delay a morning's egg tallies, and a photo that fails must not take
     * them with it. See `sync/photos.ts`.
     */
    await movePhotos();
    schedule(IDLE_MS, transport);
    await publish();
    return;
  }

  syncing = true;
  await publish();

  /**
   * How many rows this tick actually resolved, and whether it got to try.
   *
   * `schedule(0)` below is only safe when the last batch moved. Without that,
   * any tick that leaves the queue exactly as it found it reschedules itself
   * for zero milliseconds and the loop runs flat out.
   */
  let resolved = 0;
  let heldElsewhere = false;

  try {
    // Null means another tab holds the lock and is already doing this.
    const outcome = await withSyncLock(SYNC_LOCK, () => flushOnce(transport));
    if (outcome === null) {
      heldElsewhere = true;
    } else {
      consecutiveFailures = outcome.deferred ? consecutiveFailures + 1 : 0;
      resolved = outcome.applied + outcome.duplicate + outcome.rejected;
    }
  } catch (error) {
    // A failure here must never wedge the loop; the work is still queued.
    reportEngineError('sending your work', error);
    consecutiveFailures += 1;
  } finally {
    syncing = false;
  }

  await publish();

  /**
   * The other tab is mid-flush. Pulling would take the same lock and get the
   * same answer, so there is nothing to do this millisecond — and retrying at
   * zero delay would spin the CPU for as long as the other tab holds it.
   */
  if (heldElsewhere) {
    schedule(LOCK_HELD_MS, transport);
    return;
  }

  if (consecutiveFailures === 0) await pull();

  const next = nextDelay({
    consecutiveFailures,
    remaining: await queueDepth(),
    resolved,
  });

  // A fruitless round trip is a failure for pacing even though nothing threw,
  // so the backoff it just earned has to be remembered for the tick after.
  consecutiveFailures = next.consecutiveFailures;
  schedule(next.delay, transport);
}

export interface TickResult {
  /** Consecutive deferrals or errors before this tick's outcome is applied. */
  consecutiveFailures: number;
  /** Mutations still in the outbox after the flush. */
  remaining: number;
  /** Rows this tick actually cleared or rejected — how much the queue moved. */
  resolved: number;
}

/**
 * When to run the next tick, and what the failure count becomes.
 *
 * Pulled out of `tick` because this is where the loop lived. A server that
 * answers 200 without mentioning the batch leaves the queue exactly as it
 * found it: nothing throws, nothing is deferred, and `remaining > 0` is still
 * true — so the old rule ("work left, go again now") rescheduled for zero
 * milliseconds forever. Roughly sixty flush-and-pull pairs a second against
 * the server and the device, changing nothing, for as long as the tab was
 * open.
 *
 * The rule that replaces it: **go again immediately only if the last batch
 * actually moved.** Progress earns the fast path; the absence of an error
 * does not.
 *
 * Exported for tests. Pure, so the pacing can be asserted without a clock.
 */
export function nextDelay(result: TickResult): { delay: number; consecutiveFailures: number } {
  const { consecutiveFailures: failures, remaining, resolved } = result;

  if (failures > 0) return { delay: backoffDelay(failures), consecutiveFailures: failures };

  // More batches waiting, and the last one moved.
  if (remaining > 0 && resolved > 0) return { delay: 0, consecutiveFailures: 0 };

  // Work left and nothing moved. Back off, and count it.
  if (remaining > 0) {
    return { delay: backoffDelay(failures + 1), consecutiveFailures: failures + 1 };
  }

  return { delay: IDLE_MS, consecutiveFailures: 0 };
}

/**
 * Photo transfer never fails the loop either, and for a stronger reason: a
 * photo that will not move is the least urgent thing this app does, and the
 * records it belongs to are already synced and already readable.
 */
async function movePhotos(): Promise<void> {
  try {
    await transferPhotos();
  } catch (error) {
    reportEngineError('moving photos', error);
  }
}

/** Hydration never fails the loop — a device with stale reads still logs fine. */
async function pull(): Promise<void> {
  try {
    await withSyncLock(SYNC_LOCK, () => pullOnce());
  } catch (error) {
    reportEngineError('fetching changes', error);
  }
}

function schedule(delay: number, transport?: SyncTransport): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    /**
     * The loop's last line of defence, and it earns its place.
     *
     * `tick` guards the flush, but `publish()` and `queueDepth()` sit outside
     * that try — so anything they throw rejected this promise, and because
     * `schedule()` is the final statement of `tick`, the loop never scheduled
     * itself again. One throw and sync stopped for the life of the process,
     * reported only as an anonymous unhandled rejection.
     *
     * Nothing is lost when it fires: the mutations are still in the outbox,
     * which is the whole point of the outbox. The next tick tries again.
     */
    tick(transport).catch((error: unknown) => {
      reportEngineError('the sync loop', error);
      // Deliberately IDLE_MS rather than an immediate retry. Whatever this is
      // will almost certainly throw again, and a tight loop against it would
      // be worse than the failure.
      schedule(IDLE_MS, transport);
    });
  }, delay);
}

export interface NudgeOptions {
  /**
   * A person pressed "Try sending now", so try — whatever this module
   * currently believes about the network.
   *
   * ## Why the belief has to be overridable
   *
   * `online` is set from `addNetworkStateListener`. That listener reports
   * `isConnected: false` during transient Android transitions and leaves it
   * `undefined` on some configurations, and `undefined === true` is false — so
   * the engine can sit believing it is offline on a phone showing four bars.
   * `tick` returns before flushing anything in that state, which is right for
   * a timer and wrong for a button: the press did nothing and said nothing
   * about having done nothing.
   *
   * That is the same defect as a "Try again" that retries the wrong thing. A
   * manual override that obeys the state it exists to override is a
   * decoration.
   *
   * ## Why overruling it is safe
   *
   * **The flush is the authority on whether there is a network; the listener
   * is only ever a hint.** A forced attempt with no signal fails as a network
   * error, and the queue has always handled that: the work stays queued, the
   * attempt count rises, nothing is lost. The cost of being wrong is one round
   * trip that a person explicitly asked for.
   *
   * The automatic path keeps the flag exactly as it was. A phone in a barn
   * must not spend its battery on a radio that is not there, and only a
   * deliberate press gets to say otherwise.
   */
  force?: boolean;
}

/**
 * Call after enqueueing, so a log reaches the server without waiting for a
 * timer — or with `force`, because somebody asked.
 */
export function nudge(transport?: SyncTransport, options: NudgeOptions = {}): void {
  consecutiveFailures = 0;

  if (options.force === true) {
    // Cleared rather than bypassed for this one tick: if the belief was stale,
    // it stays cleared and the loop resumes normally. If it was right, the
    // failed flush is what corrects it, and the OS listener will say so again.
    online = true;
  }

  if (running) schedule(0, transport);
  void publish();
}

export function startSync(transport?: SyncTransport): void {
  if (running) return;
  running = true;
  consecutiveFailures = 0;

  /**
   * Browser connectivity events, where there are any.
   *
   * **Guarded on the method, not the object.** React Native defines `window`
   * — it is an alias for the global — but gives it no `addEventListener`. So
   * `typeof window !== 'undefined'` passed on a handset and the next line
   * called undefined, which is the `TypeError: undefined is not a function`
   * that stopped the app booting.
   *
   * The device has better signals anyway: `sync/triggers.ts` listens to
   * AppState and expo-network, which know about a frozen process and a barn
   * with no bars. This block is for the browser build and nothing else, and
   * it is the same shape `storage.ts` and `lock.ts` already use.
   */
  schedule(0, transport);
}

export function stopSync(): void {
  running = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

export interface Diagnostics {
  deviceId: string | null;
  online: boolean;
  queued: number;
  rejected: number;
  outboxTotal: number;
  lastSyncAt: number | null;
  lastError: string | null;
  /** How far this device has hydrated — a stuck watermark explains stale reads. */
  pulledThrough: number;
  /** Rows that could not be read back and were set aside rather than dropped. */
  quarantined: number;
  integrity: Awaited<ReturnType<typeof checkIntegrity>>;
}

/**
 * Everything needed to explain a stuck queue from inside the app, on the
 * device, with no network (Observability rubric).
 */
export async function diagnostics(): Promise<Diagnostics> {
  /**
   * Every field comes from `localStore()`, and that is the whole point.
   *
   * Half of these used to be read straight out of IndexedDB while the other
   * half went through the port. In a browser both are the same database and
   * nothing looked wrong. On a handset the port is SQLite and the direct
   * reads were answering from an IndexedDB that had never been written to, so
   * the first device run reported one mutation queued and an outbox
   * containing nothing — the two numbers are the same number.
   *
   * This is the screen someone opens when they are already worried their
   * morning's work is gone. It is the last screen in the app that may
   * describe a store the app is not using.
   */
  const store = localStore();

  const [deviceId, lastSyncAt, lastError, counts, integrity, through, quarantined] =
    await Promise.all([
      store.getDeviceId(),
      store.getLastSyncAt(),
      store.getLastError(),
      store.counts(),
      checkIntegrity(),
      pulledThrough(),
      store.quarantineCount(),
    ]);

  return {
    deviceId,
    online: isOnline(),
    queued: counts.queued,
    rejected: counts.rejected,
    outboxTotal: counts.total,
    lastSyncAt,
    lastError,
    pulledThrough: through,
    quarantined,
    integrity,
  };
}
