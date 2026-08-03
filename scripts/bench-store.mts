/**
 * `pnpm bench:store` — what one lane costs, measured rather than argued about.
 *
 * The single strongest objection to serialising every SQL operation (see
 * `packages/core/src/db/gate.ts`) is that `useDues` issues thirteen statements
 * on every engine publish, and serialising them makes a refresh wait for each
 * in turn. That objection deserved a number rather than a shrug.
 *
 * Measured on a generously-sized smallholding — 5,344 rows — the answer is
 * that the lane itself is free (under a microsecond an operation) and
 * serialising a whole refresh costs about 55ms, flat, whatever the per-call
 * latency. That is a background refresh on a screen already rendered from the
 * local projection, so it is a price worth paying for a driver that cannot
 * hand a statement to a connection somebody is about to close.
 *
 * The more useful finding is where the time actually goes: **Zod is 80% of a
 * refresh** and SQL is 20%. If a refresh ever needs to be faster, the parse is
 * the thing to attack, not the lane.
 */

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { type Entity, MUTATION_SCHEMA_VERSION, newId } from '@steading/contracts';
import type { SqlValue } from '@steading/core/db/driver';
import { openSqliteStore } from '@steading/core/db/sqlite-store';
import { setLocalStore } from '@steading/core/db/store';
import { createGate } from '@steading/core/db/gate';
import { createExpoDriver, type SqliteConnection } from '@steading/mobile/db/expo-driver';
import { fakeExpoConnection } from '../tests/support/expo-sqlite';

/**
 * What a refresh actually costs, and what serialising it adds.
 *
 * Two numbers matter and they are measured separately:
 *   1. the JS-side cost of the lane itself (pure overhead, no I/O);
 *   2. the shape of a `useDues` refresh — how many statements, how much of the
 *      wall clock is SQL and how much is Zod.
 * The device round-trip latency cannot be measured here, so it is a parameter.
 */

/** One device, so clientSeq is a real per-device sequence. */
const DEVICE_ID = '00000000-0000-4000-8000-000000000001';

const ENTITIES: Partial<Record<Entity, number>> = {
  // A working smallholding, generously sized. The library alone contributes
  // most of `variety`.
  flock: 24,
  animal: 180,
  careLog: 2_400,
  breeding: 60,
  incubation: 12,
  bed: 40,
  planting: 220,
  variety: 400,
  equipment: 18,
  hourReading: 1_500,
  maintenance: 90,
  inventory: 260,
  medication: 140,
};

/** Charges `perCall` ms to every native call, in parallel across calls. */
function latentConnection(inner: SqliteConnection, perCall: number): SqliteConnection {
  const hop = async (n: number): Promise<void> => {
    // expo issues N native calls per statement: prepare / run / getAll /
    // finalize. Each is dispatched onto Dispatchers.IO and resolved back on
    // the JS thread, so each is one round trip.
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, perCall));
  };
  return {
    async runAsync(sql, params) {
      await hop(3);
      return inner.runAsync(sql, params);
    },
    async getAllAsync<T>(sql: string, params: SqlValue[]) {
      await hop(4);
      return inner.getAllAsync<T>(sql, params);
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[]) {
      await hop(4);
      return inner.getFirstAsync<T>(sql, params);
    },
    async execAsync(sql) {
      await hop(1);
      return inner.execAsync(sql);
    },
    async withExclusiveTransactionAsync(task) {
      return inner.withExclusiveTransactionAsync(task);
    },
    async closeAsync() {
      return inner.closeAsync();
    },
  };
}

async function seed(store: Awaited<ReturnType<typeof openSqliteStore>>): Promise<void> {
  // Straight into the projection: enqueue would put 5,000 rows in the outbox
  // too, which is not the state being measured.
  const now = Date.now();
  const pulled = [];
  for (const [entity, n] of Object.entries(ENTITIES) as [Entity, number][]) {
    for (let i = 0; i < n; i++) {
      pulled.push({
        id: newId(),
        targetId: newId(),
        entity,
        op: 'create' as const,
        // A pulled row is a whole envelope, not just a payload — the store
        // parses it, so a partial one measures the wrong thing.
        schemaVersion: MUTATION_SCHEMA_VERSION,
        deviceId: DEVICE_ID,
        clientSeq: i,
        clientTs: now - i * 1000,
        payload: {
          name: `${entity}-${i}`,
          species: 'chicken',
          count: 12,
          occurredAt: now - i * 1000,
          administeredAt: now - i * 1000,
          quantity: 3,
          note: 'x'.repeat(40),
        },
        serverTs: now - i,
      });
    }
  }
  // In pages, the way pull does it.
  for (let i = 0; i < pulled.length; i += 500) {
    await store.applyPulled(pulled.slice(i, i + 500), { through: now, throughId: newId() });
  }
}

function ms(v: number): string {
  return `${v.toFixed(2)}ms`;
}

async function main(): Promise<void> {
  // ── 1. the lane's own overhead ────────────────────────────────────────────
  {
    const gate = createGate();
    const N = 200_000;
    const bare = performance.now();
    for (let i = 0; i < N; i++) await Promise.resolve(i);
    const bareMs = performance.now() - bare;

    const gated = performance.now();
    for (let i = 0; i < N; i++) await gate.enter(async () => i);
    const gatedMs = performance.now() - gated;

    console.log(`lane overhead: ${((gatedMs - bareMs) / N) * 1000} µs per op`);
    console.log(`  (${N} sequential ops: bare ${ms(bareMs)}, gated ${ms(gatedMs)})`);
  }

  // ── 2. what a refresh is made of ──────────────────────────────────────────
  {
    const connection = fakeExpoConnection();
    const driver = createExpoDriver(connection);
    const store = await openSqliteStore(driver, { randomUUID });
    setLocalStore(store);
    await seed(store);

    const entities = Object.keys(ENTITIES) as Entity[];
    // The 13 statements `useDues.refresh` issues, via the store.
    const sql = performance.now();
    const raw = await Promise.all(entities.map((e) => driver.all('SELECT * FROM records WHERE entity = ?', [e])));
    const sqlMs = performance.now() - sql;

    const full = performance.now();
    const parsed = await Promise.all(entities.map((e) => store.readRecordsByEntity(e)));
    const fullMs = performance.now() - full;

    const rows = raw.reduce((n, r) => n + r.length, 0);
    console.log(`\nrefresh over ${rows} rows, 13 statements`);
    console.log(`  SQL only            ${ms(sqlMs)}`);
    console.log(`  SQL + Zod (store)   ${ms(fullMs)}  → Zod ${ms(fullMs - sqlMs)} (${(((fullMs - sqlMs) / fullMs) * 100).toFixed(0)}% of it)`);
    console.log(`  parsed rows         ${parsed.reduce((n, r) => n + r.length, 0)}`);
    await store.close();
  }

  // ── 3. the device model ───────────────────────────────────────────────────
  // Serialised (the fix) versus issued concurrently (today), for the 13
  // statements of a refresh, at a range of per-round-trip latencies.
  console.log('\nwall clock for one refresh (13 statements), by round-trip latency');
  console.log('  r      concurrent   serialised   added');
  for (const r of [0.05, 0.1, 0.25, 0.5, 1]) {
    const connection = latentConnection(fakeExpoConnection(), r);
    const driver = createExpoDriver(connection);
    await driver.run('CREATE TABLE records (key TEXT PRIMARY KEY, entity TEXT)');

    const serial = performance.now();
    for (let i = 0; i < 13; i++) await driver.all('SELECT * FROM records WHERE entity = ?', ['x']);
    const serialMs = performance.now() - serial;

    // Today's driver issues all 13 at once onto a multi-threaded IO pool.
    const raw = latentConnection(fakeExpoConnection(), r);
    const concurrentStart = performance.now();
    await Promise.all(
      Array.from({ length: 13 }, () => raw.getAllAsync('SELECT 1', [])),
    );
    const concurrentMs = performance.now() - concurrentStart;

    console.log(
      `  ${r.toFixed(2)}ms  ${ms(concurrentMs).padStart(10)}   ${ms(serialMs).padStart(10)}   +${ms(serialMs - concurrentMs)}`,
    );
    await driver.close();
  }
}

void main();
