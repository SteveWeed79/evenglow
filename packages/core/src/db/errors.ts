import { PRODUCT_NAME } from '@steading/contracts';
/**
 * Storage failures the UI has to tell apart.
 *
 * Their own module because every storage implementation throws them and the
 * engine catches them, so putting them with either one creates a cycle — and
 * declaring them twice would let a `catch` in the engine miss the class the
 * other store threw.
 */

/**
 * The device has no room left. Distinct from InvalidMutationError because the
 * mutation is fine — the storage is not — and the two need different advice.
 */
export class StorageFullError extends Error {
  constructor() {
    super('This device is out of space. Sync to free room, then try again.');
    this.name = 'StorageFullError';
  }
}

export class InvalidMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMutationError';
  }
}

/**
 * The file on this device was written by a build newer than this one.
 *
 * `migrate()` walks forward and has nothing to say about walking back, so a
 * database at a version above `SCHEMA_VERSION` used to fall straight through
 * the loop and return that higher number — the app then ran against a schema
 * this build has never seen, reading tables whose columns may have moved and
 * writing rows the newer build will meet later.
 *
 * **Refusing is the conservative act here, and that is not obvious.** A farm
 * that cannot open its records has lost a morning; a farm whose records were
 * quietly written against half a schema has lost the records. The one way this
 * happens in the field is a downgrade — a sideloaded APK installed over a
 * newer one, which `[156]` says is the only route back from a bad release —
 * and it is temporary by nature: the file is intact and the newer build opens
 * it again.
 *
 * So the message names the fix rather than the fault, and says nothing that
 * could be read as a suggestion to clear app data. Clearing it is the one
 * action that would turn this into the loss it exists to prevent.
 */
export class DatabaseFromTheFutureError extends Error {
  /** The version on disk. */
  readonly found: number;
  /** The newest version this build knows how to make. */
  readonly expected: number;

  constructor(found: number, expected: number) {
    super(
      `These records were written by a newer version of ${PRODUCT_NAME}. ` +
       +
        'Nothing is lost — install the newer version again to open them. ' +
        `(This build reads v${expected}; the records are v${found}.)`,
    );
    this.name = 'DatabaseFromTheFutureError';
    this.found = found;
    this.expected = expected;
  }
}
