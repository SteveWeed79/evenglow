import {
  MUTATION_SCHEMA_VERSION,
  type MutationResult,
  mutationSchema,
  newId,
  type PulledMutation,
} from '@steading/contracts';
import type {
  EnqueueRequest,
  IntegrityReport,
  LocalStore,
  PullResult,
  QueueCounts,
  SnapshotWatermark,
} from '@steading/app/db/port';
import { closeDb, db, listQuarantined, quarantineCount, readOutboxBySeq, readRecordsByEntity, wipeLocalData } from './open';
import { toLocalRecord } from './project';
import { META, parseMeta, type QueuedMutation, type Quarantined, STORES } from './schema';
import { InvalidMutationError, StorageFullError } from '@steading/app/db/errors';

/**
 * `LocalStore` over IndexedDB.
 *
 * The reference implementation, wrapping the engine's existing storage
 * primitives. It exists so both stores can be held to ONE suite: the SQLite
 * one is correct exactly when it behaves like this, and asserting that
 * directly is worth more than reading the two side by side.
 *
 * This goes away in S7 with the rest of the browser engine. Until then it is
 * the thing the port is measured against, which is why the masterplan says not
 * to delete the old engine early (§0.1).
 */

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

export function idbLocalStore(): LocalStore {
  return {
    /**
     * ONE IndexedDB transaction: mint the sequence number, write the outbox
     * entry, advance the counter, update the projection (invariant 5).
     */
    async enqueue(request: EnqueueRequest): Promise<QueuedMutation> {
      const database = await db();
      const tx = database.transaction([STORES.outbox, STORES.meta, STORES.records], 'readwrite');
      const meta = tx.objectStore(STORES.meta);

      let deviceId = parseMeta('deviceId', await meta.get(META.deviceId));
      if (deviceId === undefined) {
        deviceId = crypto.randomUUID();
        await meta.put(deviceId, META.deviceId);
      }

      // A lost counter floors from the outbox rather than restarting at zero,
      // which would reuse sequence numbers and break ordering silently.
      const stored = parseMeta('nextClientSeq', await meta.get(META.nextClientSeq)) ?? 0;
      const highest = await tx
        .objectStore(STORES.outbox)
        .index('byClientSeq')
        .openCursor(null, 'prev');
      const floor = highest ? highest.value.clientSeq + 1 : 0;
      const clientSeq = Math.max(stored, floor);

      const checked = mutationSchema.safeParse({
        schemaVersion: MUTATION_SCHEMA_VERSION,
        id: newId(),
        targetId: request.targetId,
        entity: request.entity,
        op: request.op,
        payload: request.payload,
        deviceId,
        clientSeq,
        clientTs: Date.now(), // recorded, never trusted for ordering (D6)
      });

      if (!checked.success) {
        tx.abort();
        throw new InvalidMutationError('Could not build a valid mutation.');
      }

      const queued: QueuedMutation = {
        ...checked.data,
        status: 'queued',
        attempts: 0,
        enqueuedAt: Date.now(),
      };

      try {
        await tx.objectStore(STORES.outbox).put(queued);
        await meta.put(clientSeq + 1, META.nextClientSeq);
        await tx
          .objectStore(STORES.records)
          .put(
            toLocalRecord(request.entity, request.targetId, request.op, request.payload, Date.now()),
          );
        await tx.done;
      } catch (error) {
        // Abort explicitly: a SYNCHRONOUS throw from put() leaves the
        // transaction with no pending work, so IndexedDB auto-commits what
        // already landed — the outbox row and the advanced counter — without
        // the projection. See queue.ts for the full note.
        try {
          tx.abort();
        } catch {
          // Already settled.
        }
        // The abort rejects tx.done, which nothing is awaiting once we are
        // here; left alone it surfaces as an unrelated unhandled rejection.
        void tx.done.catch(() => undefined);
        if (isQuotaError(error)) throw new StorageFullError();
        throw error;
      }

      return queued;
    },

    async resolveBatch(batch, results): Promise<void> {
      const byId = new Map(results.map((r) => [r.id, r] as const));
      const database = await db();
      const tx = database.transaction([STORES.outbox, STORES.meta], 'readwrite');
      const outbox = tx.objectStore(STORES.outbox);
      const meta = tx.objectStore(STORES.meta);

      let cleared = 0;

      for (const mutation of batch) {
        const result: MutationResult | undefined = byId.get(mutation.id);
        if (!result) {
          // Answered without mentioning it. Stays queued — resending is safe —
          // but the attempt is counted so it cannot retry forever unseen.
          await outbox.put({ ...mutation, attempts: mutation.attempts + 1 });
          continue;
        }

        if (result.status === 'applied' || result.status === 'duplicate') {
          await outbox.delete(mutation.id);
          cleared += 1;
          continue;
        }

        await outbox.put({
          ...mutation,
          status: 'rejected',
          rejectedReason: result.reason ?? 'The server refused that record.',
          rejectedAt: Date.now(),
        });
      }

      if (cleared > 0) {
        const current = parseMeta('clearedCount', await meta.get(META.clearedCount)) ?? 0;
        await meta.put(current + cleared, META.clearedCount);
      }

      await tx.done;
    },

    async markSynced(at): Promise<void> {
      const database = await db();
      const tx = database.transaction(STORES.meta, 'readwrite');
      const meta = tx.objectStore(STORES.meta);
      await meta.put(at, META.lastSyncAt);
      await meta.delete(META.lastError);
      await tx.done;
    },

    async recordAttempt(batch, error): Promise<void> {
      const database = await db();
      const tx = database.transaction([STORES.outbox, STORES.meta], 'readwrite');
      const outbox = tx.objectStore(STORES.outbox);

      for (const queued of batch) {
        const current = await outbox.get(queued.id);
        if (!current) continue;
        await outbox.put({ ...current, attempts: current.attempts + 1, lastError: error });
      }

      await tx.objectStore(STORES.meta).put(error, META.lastError);
      await tx.done;
    },

    async rejectExhausted(batch, maxAttempts, reason): Promise<void> {
      const database = await db();
      const tx = database.transaction(STORES.outbox, 'readwrite');
      const outbox = tx.objectStore(STORES.outbox);

      for (const queued of batch) {
        const current = await outbox.get(queued.id);
        if (!current || current.status === 'rejected') continue;
        if (current.attempts < maxAttempts) continue;

        await outbox.put({
          ...current,
          status: 'rejected',
          rejectedReason: reason,
          rejectedAt: Date.now(),
        });
      }

      await tx.done;
    },

    async listRejected(): Promise<QueuedMutation[]> {
      return (await readOutboxBySeq()).filter((m) => m.status === 'rejected');
    },

    async retryRejected(id, payload): Promise<void> {
      const database = await db();
      const tx = database.transaction(STORES.outbox, 'readwrite');
      const outbox = tx.objectStore(STORES.outbox);

      const current = await outbox.get(id);
      if (!current) {
        await tx.done;
        return;
      }

      const { rejectedReason: _reason, rejectedAt: _at, lastError: _error, ...rest } = current;

      // Attempts reset: the user has changed something, so the previous
      // failures are not evidence about this one.
      await outbox.put({
        ...rest,
        ...(payload === undefined ? {} : { payload }),
        status: 'queued',
        attempts: 0,
      });
      await tx.done;
    },

    async discardRejected(id): Promise<void> {
      const database = await db();
      const tx = database.transaction([STORES.outbox, STORES.meta], 'readwrite');
      const outbox = tx.objectStore(STORES.outbox);
      const meta = tx.objectStore(STORES.meta);

      // ONLY a rejected mutation. Without the status check a stray call
      // deletes queued work that has not been sent yet.
      const current = await outbox.get(id);
      if (!current || current.status !== 'rejected') {
        await tx.done;
        return;
      }

      await outbox.delete(id);

      // A discard is a resolution; skipping the counter makes the integrity
      // check later report data loss for something the user did on purpose.
      const cleared = parseMeta('clearedCount', await meta.get(META.clearedCount)) ?? 0;
      await meta.put(cleared + 1, META.clearedCount);
      await tx.done;
    },

    readOutboxBySeq,
    readRecordsByEntity,

    async counts(): Promise<QueueCounts> {
      const database = await db();
      const [queued, rejected, total] = await Promise.all([
        database.countFromIndex(STORES.outbox, 'byStatus', 'queued'),
        database.countFromIndex(STORES.outbox, 'byStatus', 'rejected'),
        database.count(STORES.outbox),
      ]);
      return { queued, rejected, total };
    },

    async checkIntegrity(): Promise<IntegrityReport> {
      const database = await db();
      const tx = database.transaction([STORES.outbox, STORES.meta], 'readonly');
      const meta = tx.objectStore(STORES.meta);

      const everEnqueued = parseMeta('nextClientSeq', await meta.get(META.nextClientSeq)) ?? 0;
      const cleared = parseMeta('clearedCount', await meta.get(META.clearedCount)) ?? 0;
      const actualInOutbox = await tx.objectStore(STORES.outbox).count();
      await tx.done;

      const expectedInOutbox = everEnqueued - cleared;
      return {
        everEnqueued,
        cleared,
        expectedInOutbox,
        actualInOutbox,
        missing: Math.max(0, expectedInOutbox - actualInOutbox),
      };
    },

    async applyPulled(mutations: readonly PulledMutation[], cursor): Promise<PullResult> {
      const database = await db();
      const tx = database.transaction([STORES.outbox, STORES.records, STORES.meta], 'readwrite');
      const records = tx.objectStore(STORES.records);

      // Local optimistic state wins until it flushes: a queued edit visibly
      // reverting is the most alarming thing an offline app can do.
      const pending = new Set<string>();
      for (const queued of await tx.objectStore(STORES.outbox).getAll()) {
        pending.add(queued.targetId);
      }

      let applied = 0;
      let skipped = 0;

      for (const mutation of mutations) {
        if (pending.has(mutation.targetId)) {
          skipped += 1;
          continue;
        }
        await records.put(
          toLocalRecord(
            mutation.entity,
            mutation.targetId,
            mutation.op,
            mutation.payload,
            mutation.serverTs,
          ),
        );
        applied += 1;
      }

      // Both halves, in the same transaction as the records they cover.
      const meta = tx.objectStore(STORES.meta);
      await meta.put(cursor.through, META.pulledThrough);
      if (cursor.throughId !== null) await meta.put(cursor.throughId, META.pulledThroughId);
      await tx.done;

      return { applied, skipped };
    },

    async pulledThrough(): Promise<SnapshotWatermark> {
      const database = await db();
      return {
        through: parseMeta('pulledThrough', await database.get(STORES.meta, META.pulledThrough)) ?? 0,
        throughId:
          parseMeta('pulledThroughId', await database.get(STORES.meta, META.pulledThroughId)) ??
          null,
      };
    },

    async getLastSyncAt(): Promise<number | null> {
      return (
        parseMeta('lastSyncAt', await (await db()).get(STORES.meta, META.lastSyncAt)) ?? null
      );
    },

    async getLastError(): Promise<string | null> {
      return parseMeta('lastError', await (await db()).get(STORES.meta, META.lastError)) ?? null;
    },

    async setLastError(message): Promise<void> {
      await (await db()).put(STORES.meta, message, META.lastError);
    },

    async getDeviceId(): Promise<string | null> {
      return parseMeta('deviceId', await (await db()).get(STORES.meta, META.deviceId)) ?? null;
    },

    quarantineCount,

    async listQuarantined(): Promise<Quarantined[]> {
      return listQuarantined();
    },

    wipe: wipeLocalData,
    close: closeDb,
  };
}
