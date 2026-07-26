import { db, getMeta } from '../db/open';
import { STORES } from '../db/schema';
import { backoffDelay, flushOnce, type SyncTransport } from './flush';
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
export async function currentState(): Promise<SyncState> {
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

  if (!isOnline() || (await queueDepth()) === 0) {
    schedule(30_000, transport);
    await publish();
    return;
  }

  syncing = true;
  await publish();

  try {
    const outcome = await flushOnce(transport);
    consecutiveFailures = outcome.deferred ? consecutiveFailures + 1 : 0;
  } catch (error) {
    // A failure here must never wedge the loop; the work is still queued.
    console.warn('Steading: flush failed', error);
    consecutiveFailures += 1;
  } finally {
    syncing = false;
  }

  await publish();

  const remaining = await queueDepth();
  if (consecutiveFailures > 0) schedule(backoffDelay(consecutiveFailures), transport);
  else if (remaining > 0) schedule(0, transport); // more batches waiting
  else schedule(30_000, transport);
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
  integrity: Awaited<ReturnType<typeof checkIntegrity>>;
}

/**
 * Everything needed to explain a stuck queue from inside the app, on the
 * device, with no network (Observability rubric).
 */
export async function diagnostics(): Promise<Diagnostics> {
  const [deviceId, lastSyncAt, lastError, queued, rejected, integrity] = await Promise.all([
    getMeta('deviceId'),
    getMeta('lastSyncAt'),
    getMeta('lastError'),
    queueDepth(),
    rejectedCount(),
    checkIntegrity(),
  ]);

  const outboxTotal = await (await db()).count(STORES.outbox);

  return {
    deviceId: deviceId ?? null,
    online: isOnline(),
    queued,
    rejected,
    outboxTotal,
    lastSyncAt: lastSyncAt ?? null,
    lastError: lastError ?? null,
    integrity,
  };
}
