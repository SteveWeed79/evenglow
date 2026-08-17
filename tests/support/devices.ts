import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SqlDriver } from '@steading/core/db/driver';
import type { LocalStore } from '@steading/core/db/port';
import { openSqliteStore } from '@steading/core/db/sqlite-store';
import { localStore, resetLocalStore, setLocalStore } from '@steading/core/db/store';
import { nodeIds, nodeSqlDriver } from './sqlite';

/**
 * Two phones on one farm.
 *
 * ## Why this did not exist, and what its absence cost
 *
 * `SYNC-INTEGRITY-TODO.md`: *"The harness has no concept of a second device at
 * all. Not a helper, not a fixture, not one test… **Every claim in this document
 * about what device B sees is therefore untested from both ends**."*
 *
 * That is not a coverage gap in the ordinary sense. P0-2 — the worst item in
 * that document — is *entirely* about the difference between what the device
 * that acted sees and what every other device on the farm sees. A refused edit
 * lands in the actor's rejected inbox and was written into everybody else's
 * SQLite as the truth. **A suite that runs one device cannot express that
 * sentence**, so the fix shipped without a test that could have caught the bug
 * it fixed. The file says so in as many words.
 *
 * ## What was actually missing
 *
 * Less than it sounds, which is the good news. `openSqliteStore(driver, ids)`
 * already takes its own driver, and a store mints its own `deviceId` into `meta`
 * on first enqueue and keeps its own `clientSeq` — so two stores are two devices
 * without a line of production code changing. Three things stood in the way:
 *
 * 1. `tests/support/fixtures.ts` hardcodes one `DEVICE_ID` and a module-level
 *    `seq`, so every fabricated mutation claims to come from the same phone.
 * 2. `tests/support/store.ts` drives exactly one store through `setLocalStore`,
 *    and offers no way to have a second one open at the same time.
 * 3. Nothing named the operation "do this **as** that device", which is the
 *    thing every assertion about two devices is written in terms of.
 *
 * ## The store is still a module global, and `as()` respects that
 *
 * The obvious alternative — thread a store handle through `enqueue`, `flushOnce`
 * and `pullOnce` — is a production change made for a test, and `db/store.ts`
 * argues against it directly: *"components call `useLog()`, not `useLog(store)`,
 * and making the store an argument would push a storage concern into every
 * screen for no benefit."*
 *
 * So `as()` installs a device's store, runs the block, and restores what was
 * there. **A block runs to completion under one store**, which is not merely
 * convenient — `runFlush` captures `storeGeneration()` before its first await
 * and refuses to continue if it moved, precisely so a farm switch cannot land
 * mid-round-trip. Swapping devices inside a flush would trip that guard, and it
 * *should*: a device is not a thing you become halfway through sending.
 *
 * Interleaving is still expressible, because the unit that interleaves is the
 * step rather than the statement: A enqueues, B pulls, A flushes, B pulls again.
 * Each of those is its own `as()` block.
 */

export interface Device {
  /** "A" or "B" — for assertion messages, not for behaviour. */
  readonly name: string;
  readonly store: LocalStore;
  /** For a test that needs to injure this device's storage specifically. */
  readonly driver: SqlDriver;
  /**
   * Runs `work` with this device's store installed, and puts back whatever was
   * installed before.
   *
   * Restored rather than cleared, so a `twoDevices()` block nested inside a
   * `freshStore()` suite does not quietly leave the suite storeless.
   */
  as<T>(work: () => Promise<T>): Promise<T>;
  /** The uuid this store minted for itself. Null until its first enqueue. */
  deviceId(): Promise<string | null>;
}

export interface Farm {
  a: Device;
  b: Device;
  /** Both, oldest first, for assertions that walk them. */
  both: readonly [Device, Device];
  close(): Promise<void>;
}

/**
 * Whatever store is installed right now, or null.
 *
 * `db/store.ts` deliberately offers no peek — an unset store throws, naming the
 * fix, because *"a lazy default cannot be wrong loudly."* That is the right call
 * for the app and it leaves a harness that has to save and restore with nothing
 * to ask, so the throw is caught here rather than a getter being added to
 * production code for a test's benefit.
 */
function installed(): LocalStore | null {
  try {
    return localStore();
  } catch {
    return null;
  }
}

/**
 * On files rather than `:memory:`, for the same reason `freshStore` is.
 *
 * A restart against an in-memory database always looks like data loss whether
 * or not the commit reached disk, so the one distinction these suites exist to
 * draw would not exist.
 */
async function openDevice(name: string): Promise<Device> {
  const file = join(mkdtempSync(join(tmpdir(), `steading-${name}-`)), 'store.db');
  const driver = nodeSqlDriver(file);
  const store = await openSqliteStore(driver, nodeIds());

  const device: Device = {
    name,
    store,
    driver,
    async as<T>(work: () => Promise<T>): Promise<T> {
      const previous = installed();
      setLocalStore(store);
      try {
        return await work();
      } finally {
        /**
         * The store that was there, not this one.
         *
         * Written as `setLocalStore(store)` first — restoring the device's own
         * store, which is a no-op — and the harness's own suite caught it: a
         * `b.as()` nested inside an `a.as()` left B installed when control
         * returned to A, so A's next enqueue landed on B. Every assertion about
         * what B holds would have been measuring work A thought it was doing.
         *
         * Either way this bumps `storeGeneration`, which is correct: anything
         * still in flight from the block belongs to a store that is no longer
         * installed, and the engine's own guard should stop it.
         */
        if (previous === null) resetLocalStore();
        else setLocalStore(previous);
      }
    },
    deviceId: () => store.getDeviceId(),
  };

  return device;
}

/**
 * Two devices, each with its own database file, device id and sequence.
 *
 * Nothing is installed on return: a test says which device it is acting as,
 * always, because "whichever store happened to be current" is the exact
 * ambiguity this harness exists to remove.
 */
export async function twoDevices(): Promise<Farm> {
  resetLocalStore();

  const a = await openDevice('A');
  const b = await openDevice('B');

  return {
    a,
    b,
    both: [a, b],
    async close(): Promise<void> {
      resetLocalStore();
      await a.driver.close().catch(() => undefined);
      await b.driver.close().catch(() => undefined);
    },
  };
}
