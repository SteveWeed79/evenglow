import { db, getMeta, quarantineCount } from '../db/open';
import { STORES } from '../db/idb-schema';
import { backoffDelay, flushOnce, type SyncTransport } from './flush';
import { SYNC_LOCK, withSyncLock } from './lock';
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

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  void publish();
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

  const at = await getMeta('lastSyncAt');
  return { kind: 'synced', at: at === undefined ? null : new Date(at) };
}

async function publish(): Promise<void> {
  const state = await currentState();
  for (const listener of listeners) listener(state);
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
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
    console.warn('Steading: flush failed', error);
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

/** Hydration never fails the loop — a device with stale reads still logs fine. */
async function pull(): Promise<void> {
  try {
    await withSyncLock(SYNC_LOCK, () => pullOnce());
  } catch (error) {
    console.warn('Steading: pull failed', error);
  }
}

function schedule(delay: number, transport?: SyncTransport): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => void tick(transport), delay);
}

/** Call after enqueueing, so a log reaches the server without waiting for a timer. */
export function nudge(transport?: SyncTransport): void {
  consecutiveFailures = 0;
  if (running) schedule(0, transport);
  void publish();
}

export function startSync(transport?: SyncTransport): void {
  if (running) return;
  running = true;
  consecutiveFailures = 0;

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', () => void publish());
  }

  schedule(0, transport);
}

function onOnline(): void {
  consecutiveFailures = 0;
  if (running) schedule(0);
}

export function stopSync(): void {
  running = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
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
  const [deviceId, lastSyncAt, lastError, queued, rejected, integrity, through] =
    await Promise.all([
      getMeta('deviceId'),
      getMeta('lastSyncAt'),
      getMeta('lastError'),
      queueDepth(),
      rejectedCount(),
      checkIntegrity(),
      pulledThrough(),
    ]);

  const quarantined = await quarantineCount();

  const outboxTotal = await (await db()).count(STORES.outbox);

  return {
    deviceId: deviceId ?? null,
    online: isOnline(),
    queued,
    rejected,
    outboxTotal,
    lastSyncAt: lastSyncAt ?? null,
    lastError: lastError ?? null,
    pulledThrough: through,
    quarantined,
    integrity,
  };
}
